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
