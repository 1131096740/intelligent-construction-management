"""Public CLI → real exported OOXML; no database, renderer mock or private helper."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


class CandidateCLI(unittest.TestCase):
    def test_five_known_font_tables_get_typed_metadata_without_font_changes(self):
        import re
        ct = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        for name in ["equipment-rental-v1.docx", "labor-subcontract-v1.docx", "material-purchase-v1.docx", "generic-contract-v1.docx", "professional-subcontract-v1.docx"]:
            with self.subTest(template=name), tempfile.TemporaryDirectory(prefix="task08-fonttable-package-") as tmp:
                tmp = Path(tmp)
                with ZipFile(HERE / "samples" / name) as z:parts = {n: z.read(n) for n in z.namelist()}
                texts = "".join("".join(ET.fromstring(data).itertext()) for n, data in parts.items() if n.startswith("word/") and n.endswith(".xml"))
                request = tmp / "request.json"
                request.write_text(json.dumps({"fields": {k: "合成值" for k in re.findall(r"\{([^{}#/]+)\}", texts)}, "lists": {k: [] for k in re.findall(r"\{#([^{}]+)\}", texts)}}))
                output = tmp / "actual.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(HERE / "samples" / name), "--request", str(request), "--output", str(output)], check=True)
                with ZipFile(output) as z:
                    declared = [x for x in ET.fromstring(z.read("[Content_Types].xml")) if x.get("PartName") == "/word/fontTable.xml"]
                    self.assertEqual(len(declared), 1)
                    self.assertEqual(declared[0].get("ContentType"), "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml")
                    self.assertEqual(z.read("word/fontTable.xml"), parts["word/fontTable.xml"])
                types = ET.fromstring(parts["[Content_Types].xml"])
                ET.SubElement(types, ct + "Override", {"PartName": "/word/fontTable.xml", "ContentType": "application/xml"})
                conflict = tmp / name
                with ZipFile(conflict, "w") as z:
                    for n, data in parts.items():z.writestr(n, ET.tostring(types) if n == "[Content_Types].xml" else data)
                rejected = tmp / "rejected.docx"
                result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(conflict), "--request", str(request), "--output", str(rejected)], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"font table content type conflicts", result.stderr)
                self.assertFalse(rejected.exists())

    def test_only_known_unreferenced_dangling_settings_are_removed(self):
        import re
        for name in ["equipment-rental-v1.docx", "labor-subcontract-v1.docx", "material-purchase-v1.docx"]:
            with self.subTest(template=name), tempfile.TemporaryDirectory(prefix="task08-settings-package-") as tmp:
                tmp = Path(tmp)
                with ZipFile(HERE / "samples" / name) as z:parts = {n: z.read(n) for n in z.namelist()}
                texts = "".join("".join(ET.fromstring(data).itertext()) for n, data in parts.items() if n.startswith("word/") and n.endswith(".xml"))
                request = tmp / "render.json"
                request.write_text(json.dumps({"fields": {k: "合成值" for k in re.findall(r"\{([^{}#/]+)\}", texts)}, "lists": {k: [] for k in re.findall(r"\{#([^{}]+)\}", texts)}}))
                output = tmp / "actual.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(HERE / "samples" / name), "--request", str(request), "--output", str(output)], check=True)
                original_rels = ET.fromstring(parts["word/_rels/document.xml.rels"])
                expected = [x.attrib for x in original_rels if x.get("Id") != "rIdSettings"]
                with ZipFile(output) as z:
                    self.assertEqual([x.attrib for x in ET.fromstring(z.read("word/_rels/document.xml.rels"))], expected)
                    self.assertNotIn("word/settings.xml", z.namelist())
                # An actual r:id reference cannot be silently dropped.
                xml = ET.fromstring(parts["word/document.xml"])
                xml.set("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "rIdSettings")
                referenced = tmp / name
                with ZipFile(referenced, "w") as z:
                    for n, data in parts.items():z.writestr(n, ET.tostring(xml) if n == "word/document.xml" else data)
                rejected = tmp / "rejected.docx"
                result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(referenced), "--request", str(request), "--output", str(rejected)], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"referenced settings part missing", result.stderr)
                self.assertFalse(rejected.exists())
                # Existing settings are outside this repair and remain exact.
                settings = b'<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="85"/></w:settings>'
                with ZipFile(referenced, "w") as z:
                    for n, data in parts.items():z.writestr(n, data)
                    z.writestr("word/settings.xml", settings)
                preserved = tmp / "preserved.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(referenced), "--request", str(request), "--output", str(preserved)], check=True)
                with ZipFile(preserved) as z:
                    self.assertEqual(z.read("word/settings.xml"), settings)
                    self.assertEqual(z.read("word/_rels/document.xml.rels"), parts["word/_rels/document.xml.rels"])

    def test_compact_package_repair_rejects_conflicts_and_unproved_style_parts(self):
        ct = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        name = "equipment-rental-v1.docx"
        with ZipFile(HERE / "samples" / name) as z:original = {n: z.read(n) for n in z.namelist()}
        for variant in ["content-type-conflict", "wrong-root", "missing-part", "duplicate-relationship"]:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory(prefix="task08-package-reject-") as tmp:
                tmp = Path(tmp)
                parts = dict(original)
                if variant == "content-type-conflict":
                    types = ET.fromstring(parts["[Content_Types].xml"])
                    ET.SubElement(types, ct + "Override", {"PartName": "/word/styles.xml", "ContentType": "application/xml"})
                    parts["[Content_Types].xml"] = ET.tostring(types)
                elif variant == "wrong-root":parts["word/styles.xml"] = b"<notStyles/>"
                elif variant == "missing-part":parts.pop("word/styles.xml")
                else:
                    rel = ET.fromstring(parts["word/_rels/document.xml.rels"])
                    style = next(item for item in rel if item.get("Type", "").endswith("/styles"))
                    ET.SubElement(rel, style.tag, {**style.attrib, "Id": "duplicateStyles"})
                    parts["word/_rels/document.xml.rels"] = ET.tostring(rel)
                source = tmp / name
                with ZipFile(source, "w") as z:
                    for n, data in parts.items():z.writestr(n, data)
                request = tmp / "request.json"
                request.write_text('{"fields":{}}')
                output = tmp / "rejected.docx"
                result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(source), "--request", str(request), "--output", str(output)], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"reviewed compact styles", result.stderr)
                self.assertFalse(output.exists())

    def test_known_compact_style_package_declaration_is_repaired_without_style_change(self):
        import re
        ct = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        style_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
        for name in ["equipment-rental-v1.docx", "labor-subcontract-v1.docx"]:
            with self.subTest(template=name), tempfile.TemporaryDirectory(prefix="task08-style-package-") as tmp:
                tmp = Path(tmp)
                with ZipFile(HERE / "samples" / name) as z:parts = {n: z.read(n) for n in z.namelist()}
                texts = "".join("".join(ET.fromstring(data).itertext()) for n, data in parts.items() if n.startswith("word/") and n.endswith(".xml"))
                request = tmp / "render.json"
                request.write_text(json.dumps({"fields": {key: "合成值" for key in re.findall(r"\{([^{}#/]+)\}", texts)}, "lists": {key: [] for key in re.findall(r"\{#([^{}]+)\}", texts)}}))
                actual = tmp / "actual.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(HERE / "samples" / name), "--request", str(request), "--output", str(actual)], check=True)
                with ZipFile(actual) as z:
                    declarations = [item for item in ET.fromstring(z.read("[Content_Types].xml")) if item.get("PartName") == "/word/styles.xml"]
                    self.assertEqual(len(declarations), 1)
                    self.assertEqual(declarations[0].get("ContentType"), style_type)
                    self.assertEqual(z.read("word/styles.xml"), parts["word/styles.xml"])
                    document = z.read("word/document.xml")
                declared = ET.fromstring(parts["[Content_Types].xml"])
                ET.SubElement(declared, ct + "Override", {"PartName": "/word/styles.xml", "ContentType": style_type})
                fixed = tmp / name
                with ZipFile(fixed, "w") as z:
                    for n, data in parts.items():z.writestr(n, ET.tostring(declared) if n == "[Content_Types].xml" else data)
                control = tmp / "control.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(fixed), "--request", str(request), "--output", str(control)], check=True)
                with ZipFile(control) as z:self.assertEqual(z.read("word/document.xml"), document)

    def test_mechanical_totals_stay_short_and_context_syncs_outside_table(self):
        import re
        template = HERE / "samples/equipment-rental-real-v1.docx"
        with ZipFile(template) as z:
            source = ET.fromstring(z.read("word/document.xml"))
            texts = "".join("".join(ET.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.startswith("word/") and n.endswith(".xml"))
            grid = ET.tostring(source.find(".//w:tbl/w:tblGrid", NS))
        fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", texts)}
        rows = [{"名称": f"样张行{i:03d}", "规格型号": "标准型", "数量": "1.0000", "单位": "台", "是否含燃油": "否", "是否带操作人员": "是", "不含税单价": "22.1239", "税率": "13", "含税单价": "25.0000", "备注": "验证"} for i in range(1, 4)]
        with tempfile.TemporaryDirectory(prefix="task08-mechanical-") as tmp:
            tmp = Path(tmp)
            request = tmp / "request.json"
            pricing = {"mode": "unit-price", "basis": "inclusive", "total": "75.0000", "uppercase": "人民币柒拾伍元整", "taxRate": "13%", "invoiceKind": "增值税专用发票"}
            request.write_text(json.dumps({"fields": fields, "lists": {"机械租赁清单": rows}, "pricing": pricing, "printProfile": "a4-portrait"}))
            first = tmp / "first.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(template), "--request", str(request), "--output", str(first)], check=True)
            with ZipFile(first) as z:xml = ET.fromstring(z.read("word/document.xml"))
            table = xml.find(".//w:tbl", NS)
            self.assertEqual(ET.tostring(table.find("w:tblGrid", NS)), grid)
            for size in table.findall(".//w:rPr/w:sz", NS):
                self.assertGreaterEqual(int(size.get("{" + NS["w"] + "}val")), 18)
            self.assertNotIn("合同金额", "".join(table.itertext()))
            controls = table.findall(".//w:sdt", NS)
            numeric = next(c for c in controls if c.find("w:sdtPr/w:tag", NS).get("{" + NS["w"] + "}val") == "jg:key:语义.含税合计数值")
            self.assertEqual("".join(numeric.itertext()), "75.0000")
            net = next(c for c in controls if c.find("w:sdtPr/w:tag", NS).get("{" + NS["w"] + "}val") == "jg:key:语义.不含税合计数值")
            self.assertEqual("".join(net.itertext()), "待确定")
            body = xml.find("w:body", NS)
            context = body[list(body).index(table) + 1]
            self.assertEqual(context.tag, "{" + NS["w"] + "}p")
            self.assertIn("合同金额（含税）：人民币75.0000元", "".join(context.itertext()))
            for row in table.findall("w:tr", NS):
                for cell in row.findall("w:tc", NS):
                    if "".join(cell.itertext()) == "1.0000":
                        for side in ["left", "right", "start", "end"]:
                            self.assertEqual(cell.find("w:tcPr/w:tcMar/w:" + side, NS).get("{" + NS["w"] + "}w"), "40")
            pricing.update({"basis": "exclusive", "total": "1.5340", "uppercase": "人民币壹元伍角叁分肆厘", "taxRate": None})
            request.write_text(json.dumps({"pricing": pricing}))
            after = tmp / "after.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(first), "--request", str(request), "--output", str(after)], check=True)
            with ZipFile(after) as z:xml = ET.fromstring(z.read("word/document.xml"))
            numeric = next(c for c in xml.findall(".//w:tbl//w:sdt", NS) if c.find("w:sdtPr/w:tag", NS).get("{" + NS["w"] + "}val") == "jg:key:语义.含税合计数值")
            self.assertEqual("".join(numeric.itertext()), "待确定")
            net = next((c for c in xml.findall(".//w:tbl//w:sdt", NS) if c.find("w:sdtPr/w:tag", NS).get("{" + NS["w"] + "}val") == "jg:key:语义.不含税合计数值"), None)
            self.assertIsNotNone(net, "net total must join the same authoritative pricing context")
            self.assertEqual("".join(net.itertext()), "1.5340")
            text = "".join(xml.itertext())
            self.assertIn("合同金额（不含税）：人民币1.5340元", text)
            self.assertIn("表内含税合计待确定", text)
            self.assertNotIn("合同金额（含税）：人民币1.5340", text)
            request.write_text(json.dumps({"fields": {"不含税总额": "9.9999"}}))
            rejected = tmp / "rejected.docx"
            result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(after), "--request", str(request), "--output", str(rejected)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"one authoritative context", result.stderr)
            self.assertFalse(rejected.exists())

    def test_ambiguous_table_loop_rejects_extra_unmapped_block(self):
        import re
        template = HERE / "samples/labor-subcontract-real-v1.docx"
        with ZipFile(template) as z:parts = {name: z.read(name) for name in z.namelist()}
        xml = ET.fromstring(parts["word/document.xml"])
        body = xml.find("w:body", NS)
        start = next(i for i, p in enumerate(body) if "".join(p.itertext()).strip() == "{#劳务清单}")
        extra = ET.Element("{" + NS["w"] + "}p")
        ET.SubElement(ET.SubElement(extra, "{" + NS["w"] + "}r"), "{" + NS["w"] + "}t").text = "需要显式确认归属的循环说明"
        body.insert(start + 1, extra)
        with tempfile.TemporaryDirectory(prefix="task08-ambiguous-") as tmp:
            tmp = Path(tmp)
            fixture = tmp / "ambiguous.docx"
            with ZipFile(fixture, "w") as z:
                for name, data in parts.items():z.writestr(name, ET.tostring(xml) if name == "word/document.xml" else data)
            texts = "".join("".join(ET.fromstring(data).itertext()) for name, data in parts.items() if name.startswith("word/") and name.endswith(".xml"))
            fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", texts)}
            request = tmp / "request.json"
            request.write_text(json.dumps({"fields": fields, "lists": {"劳务清单": [{"序号": "1", "名称": "样张行001", "单位": "件", "数量": "1", "单价": "25.00", "含税金额": "25.00", "备注": "验证"}]}}))
            output = tmp / "actual.docx"
            result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(fixture), "--request", str(request), "--output", str(output)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())

    def test_print_profile_removes_only_terminal_whitespace_and_preserves_bookmarks(self):
        import re
        template = HERE / "samples/labor-subcontract-real-v1.docx"
        with ZipFile(template) as z:
            parts = {name: z.read(name) for name in z.namelist()}
        source = ET.fromstring(parts["word/document.xml"])
        source_blank = sum(not "".join(p.itertext()).strip() for p in source.findall(".//w:p", NS))
        fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", "".join(source.itertext()))}
        fields["文档水印"] = "技术验证草稿"
        row = {"序号": "1", "名称": "样张行001", "单位": "件", "数量": "1", "单价": "25.00", "含税金额": "25.00", "备注": "合成技术验证"}
        for protected in [False, True]:
            with self.subTest(protected=protected), tempfile.TemporaryDirectory(prefix="task08-tail-") as tmp:
                tmp = Path(tmp)
                if protected:
                    xml = ET.fromstring(parts["word/document.xml"])
                    paragraph = xml.find("w:body", NS)[-2]
                    ET.SubElement(paragraph, "{" + NS["w"] + "}bookmarkStart", {"{" + NS["w"] + "}id": "42", "{" + NS["w"] + "}name": "preserve_signature_anchor"})
                    ET.SubElement(paragraph, "{" + NS["w"] + "}bookmarkEnd", {"{" + NS["w"] + "}id": "42"})
                    fixture = tmp / "guarded.docx"
                    with ZipFile(fixture, "w") as z:
                        for name, data in parts.items():z.writestr(name, ET.tostring(xml) if name == "word/document.xml" else data)
                else:
                    fixture = template
                request = tmp / "request.json"
                request.write_text(json.dumps({"fields": fields, "lists": {"劳务清单": [row]}, "printProfile": "a4-portrait"}))
                output = tmp / "actual.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(fixture), "--request", str(request), "--output", str(output)], check=True)
                with ZipFile(output) as z:actual = ET.fromstring(z.read("word/document.xml"))
                blank = sum(not "".join(p.itertext()).strip() for p in actual.findall(".//w:p", NS))
                self.assertEqual(blank, source_blank if protected else source_blank - 6)
                if protected:self.assertIsNotNone(actual.find(".//w:bookmarkStart", NS))

    def test_block_table_loop_keeps_one_header_and_repeats_only_data_rows(self):
        import re
        template = HERE / "samples/labor-subcontract-real-v1.docx"
        with ZipFile(template) as z:
            source_xml = ET.fromstring(z.read("word/document.xml"))
            signature_tables = [ET.tostring(t) for t in source_xml.findall(".//w:tbl", NS)[:2]]
            source_text = "".join("".join(ET.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.startswith("word/") and n.endswith(".xml"))
        for count in [3, 45]:
            with self.subTest(rows=count), tempfile.TemporaryDirectory(prefix="task08-loop-") as tmp:
                tmp = Path(tmp)
                fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", source_text)}
                rows = [{"序号": str(i), "名称": f"样张行{i:03d}", "单位": "件", "数量": "1", "单价": "25.00", "含税金额": "25.00", "备注": "合成技术验证"} for i in range(1, count + 1)]
                request = tmp / "request.json"
                request.write_text(json.dumps({"fields": fields, "lists": {"劳务清单": rows}}))
                output = tmp / "actual.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(template), "--request", str(request), "--output", str(output)], check=True)
                with ZipFile(output) as z:
                    xml = ET.fromstring(z.read("word/document.xml"))
                tables = xml.findall(".//w:tbl", NS)
                self.assertEqual([ET.tostring(t) for t in tables[:2]], signature_tables)
                bills = [t for t in tables if "项目名称" in "".join(t.itertext())]
                self.assertEqual(len(bills), 1)
                self.assertEqual(len(bills[0].findall("w:tr", NS)), count + 1)
                self.assertEqual("".join(bills[0].itertext()).count("项目名称"), 1)
                self.assertIsNotNone(bills[0].find("w:tr/w:trPr/w:tblHeader", NS))
                self.assertEqual(["".join(row.itertext()) for row in bills[0].findall("w:tr", NS)[1:]], [f"{i}样张行{i:03d}件125.0025.00合成技术验证" for i in range(1, count + 1)])

    def test_eight_real_templates_have_explicit_semantic_total_mapping(self):
        import re
        for template in sorted((HERE / "samples").glob("*.docx")):
            with self.subTest(template=template.name), tempfile.TemporaryDirectory(prefix="task08-map-") as tmp:
                tmp = Path(tmp)
                with ZipFile(template) as z:
                    source_text = "".join("".join(ET.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.startswith("word/") and n.endswith(".xml"))
                    styles = z.read("word/styles.xml")
                fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", source_text)}
                lists = {key: [] for key in re.findall(r"\{#([^{}]+)\}", source_text)}
                request = tmp / "request.json"
                request.write_text(json.dumps({"fields": fields, "lists": lists, "pricing": {"mode": "framework", "basis": "exclusive", "total": None, "uppercase": None, "taxRate": None, "invoiceKind": None}}))
                output = tmp / "actual.docx"
                subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(template), "--request", str(request), "--output", str(output)], check=True)
                with ZipFile(output) as z:
                    actual = "".join(ET.fromstring(z.read("word/document.xml")).itertext())
                    self.assertEqual(styles, z.read("word/styles.xml"))
                self.assertIn("合同金额（不含税）：部分金额待确定（非最终总价）", actual)
                self.assertNotIn("合同金额（含税）", actual)
                self.assertNotIn("人民币元", actual)

    def test_pricing_semantic_anchors_keep_unknowns_and_sync_basis_without_losing_clause(self):
        with tempfile.TemporaryDirectory(prefix="task08-pricing-") as tmp:
            tmp = Path(tmp)
            template = HERE / "samples/generic-contract-v1.docx"
            with ZipFile(template) as z:
                import re
                texts = "".join("".join(ET.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.startswith("word/") and n.endswith(".xml"))
                styles = z.read("word/styles.xml")
            fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", texts)}
            request = tmp / "request.json"
            request.write_text(json.dumps({"fields": fields, "lists": {"通用清单": []}, "pricing": {"mode": "framework", "basis": "inclusive", "total": None, "uppercase": None, "taxRate": None, "invoiceKind": None}}))
            first = tmp / "framework.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(template), "--request", str(request), "--output", str(first)], check=True)
            with ZipFile(first) as z:
                actual = "".join(ET.fromstring(z.read("word/document.xml")).itertext())
            self.assertIn("部分金额待确定（非最终总价）", actual)
            self.assertIn("税率：待补充", actual)
            self.assertNotIn("人民币元", actual)
            self.assertNotIn("0.00", actual)
            request.write_text(json.dumps({"insert": {"afterText": "第三条 付款条款", "text": "新增约定：付款日另行书面确认。"}}))
            edited = tmp / "edited.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(first), "--request", str(request), "--output", str(edited)], check=True)
            request.write_text(json.dumps({"pricing": {"mode": "lumpsum", "basis": "exclusive", "total": "1.5340", "uppercase": "人民币壹元伍角叁分肆厘", "taxRate": None, "invoiceKind": None}}))
            synced = tmp / "untaxed.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(edited), "--request", str(request), "--output", str(synced)], check=True)
            with ZipFile(synced) as z:
                actual = "".join(ET.fromstring(z.read("word/document.xml")).itertext())
                self.assertEqual(styles, z.read("word/styles.xml"))
            self.assertIn("合同金额（不含税）：人民币1.5340元（大写：人民币壹元伍角叁分肆厘）", actual)
            self.assertNotIn("合同金额（含税）", actual)
            self.assertIn("计价方式：包干", actual)
            self.assertIn("新增约定：付款日另行书面确认。", actual)
            request.write_text(json.dumps({"fields": {"税率": "13%"}}))
            invalid = tmp / "inconsistent.docx"
            refused = subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(synced), "--request", str(request), "--output", str(invalid)], capture_output=True)
            self.assertNotEqual(refused.returncode, 0)
            self.assertFalse(invalid.exists())

    def test_explicit_print_profile_keeps_fullwidth_comma_in_actual_pdf(self):
        with tempfile.TemporaryDirectory(prefix="task08-punctuation-") as tmp:
            tmp = Path(tmp)
            template = HERE / "samples/labor-subcontract-real-v1.docx"
            import re
            with ZipFile(template) as z:
                texts = "".join("".join(ET.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.startswith("word/") and n.endswith(".xml"))
            fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", texts)}
            fields["文档水印"] = "技术验证草稿"
            request = tmp / "request.json"
            request.write_text(json.dumps({"fields": fields, "lists": {"劳务清单": []}, "printProfile": "a4-portrait"}))
            docx, pdf = tmp / "actual.docx", tmp / "actual.pdf"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(template), "--request", str(request), "--output", str(docx)], check=True)
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "export-pdf", "--document", str(docx), "--output", str(pdf)], check=True)
            import pymupdf
            with pymupdf.open(pdf) as output:
                actual = re.sub(r"\s+", "", "".join(page.get_text() for page in output))
            self.assertIn("公司审批后方可生效，否则不予作为最终结算依据。", actual)

    def test_authoritative_sync_preserves_inserted_clause_and_original_format(self):
        with tempfile.TemporaryDirectory(prefix="task08-test-") as tmp:
            tmp = Path(tmp)
            request = tmp / "request.json"
            template = HERE / "samples/generic-contract-v1.docx"
            with ZipFile(template) as z:
                original_styles = z.read("word/styles.xml")
                xml = ET.fromstring(z.read("word/document.xml"))
                text = "".join(xml.itertext())
            import re
            fields = {key: "待补充" for key in re.findall(r"\{([^{}#/]+)\}", text)}
            fields.update({"甲方名称": "合成甲方一", "乙方名称": "合成乙方一", "合同金额": "125.00", "文档水印": "技术验证草稿"})
            request.write_text(json.dumps({"fields": fields, "lists": {"通用清单": []}}))
            first = tmp / "first.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "render", "--template", str(template), "--request", str(request), "--output", str(first)], check=True)
            request.write_text(json.dumps({"fields": {"甲方名称": "合成甲方二", "合同金额": "250.00"}, "insert": {"afterText": "第三条 付款条款", "text": "新增约定：夜间作业须双方书面确认。"}}))
            final = tmp / "final.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(first), "--request", str(request), "--output", str(final)], check=True)
            with ZipFile(final) as z:
                actual = "".join(ET.fromstring(z.read("word/document.xml")).itertext())
                self.assertEqual(z.read("word/styles.xml"), original_styles)
            self.assertIn("合成甲方二", actual)
            self.assertNotIn("合成甲方一", actual)
            self.assertIn("250.00", actual)
            self.assertNotIn("125.00", actual)
            self.assertIn("新增约定：夜间作业须双方书面确认。", actual)

            request.write_text(json.dumps({"edit": {"exactText": "新增约定：夜间作业须双方书面确认。", "replacement": "新增约定：夜间作业须提前两天书面确认。"}}))
            edited = tmp / "edited.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(final), "--request", str(request), "--output", str(edited)], check=True)
            request.write_text(json.dumps({"fields": {"乙方名称": "合成乙方二"}}))
            synced = tmp / "synced.docx"
            subprocess.run([sys.executable, str(HERE / "candidate.py"), "revise", "--document", str(edited), "--request", str(request), "--output", str(synced)], check=True)
            with ZipFile(synced) as z:
                actual = "".join(ET.fromstring(z.read("word/document.xml")).itertext())
            self.assertIn("新增约定：夜间作业须提前两天书面确认。", actual)
            self.assertNotIn("新增约定：夜间作业须双方书面确认。", actual)
            self.assertIn("合成乙方二", actual)

            request.write_text(json.dumps({"fields": fields, "lists": {"通用清单": []}}))
            replaced = tmp / "replaced.docx"
            command = [sys.executable, str(HERE / "candidate.py"), "regenerate", "--document", str(synced), "--template", str(template), "--request", str(request), "--output", str(replaced)]
            refused = subprocess.run(command, capture_output=True)
            self.assertNotEqual(refused.returncode, 0)
            self.assertFalse(replaced.exists())
            subprocess.run(command + ["--confirm-discard-manual-clauses"], check=True)
            self.assertEqual(replaced.with_suffix(".previous.docx").read_bytes(), synced.read_bytes())


if __name__ == "__main__":
    unittest.main()
