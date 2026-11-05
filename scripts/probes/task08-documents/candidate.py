"""Disposable DOCX-first candidate. Not connected to application or storage."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

from lxml import etree as E

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
NS = {"w": W[1:-1]}
TOKEN = re.compile(r"\{([^{}]+)\}")
TOTAL_CONTEXT = "合同金额（含税）：人民币{合同金额}元（大写：{合同金额大写}）"
SEMANTIC_TOTAL_SOURCE = {
    "generic-contract-v1.docx": TOTAL_CONTEXT,
    "professional-subcontract-v1.docx": TOTAL_CONTEXT,
    "labor-subcontract-real-v1.docx": TOTAL_CONTEXT,
    "equipment-rental-real-v1.docx": "{合同金额}",
    "equipment-rental-v1.docx": "合同金额大写：{合同金额大写}",
    "labor-subcontract-v1.docx": "合同金额大写：{合同金额大写}",
    "material-purchase-v1.docx": "合同金额大写：{合同金额大写}",
    "material-purchase-real-v1.docx": "本合同暂定总价（含税）{合同金额}元（大写：人民币{合同金额大写}）。其中，不含税价合计为{不含税总额}元（大写：人民币{不含税总额大写}），税额合计为{税额总计}元（大写：人民币{税额总计大写}）",
}


def text(node):
    return "".join(node.itertext()) if node.tag == W + "t" else "".join(node.xpath(".//w:t/text()", namespaces=NS))


def substitute(root, values, anchors=True, pattern=TOKEN):
    for paragraph in list(root.iter(W + "p")):
        nodes = list(paragraph.iter(W + "t"))
        spans, offset = [], 0
        for node in nodes:
            end = offset + len(node.text or "")
            spans.append((offset, end, node))
            offset = end
        for match in reversed(list(pattern.finditer("".join(n.text or "" for n in nodes)))):
            key = match[1]
            if key not in values:
                continue
            affected = [(start, end, n) for start, end, n in spans if start < match.end() and end > match.start()]
            first_start, _, first = affected[0]
            run = first.getparent()
            if run.tag != W + "r" or len(run.findall(W + "t")) != 1:
                raise ValueError("unsupported placeholder run; mapping requires explicit review")
            suffix = None
            if len(affected) == 1:
                suffix = deepcopy(run)
                suffix.find(W + "t").text = (first.text or "")[match.end() - first_start:]
            for start, end, node in affected:
                value = node.text or ""
                a, b = max(0, match.start() - start), min(len(value), match.end() - start)
                node.text = value[:a] + value[b:]
            if suffix is not None:
                first.text = (first.text or "")[:match.start() - first_start]
            replacement = E.Element(W + "r")
            props = run.find(W + "rPr")
            if props is not None:
                replacement.append(deepcopy(props))
            t = E.SubElement(replacement, W + "t")
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            t.text = str(values[key])
            inserted = replacement
            if anchors:
                inserted = E.Element(W + "sdt")
                pr = E.SubElement(inserted, W + "sdtPr")
                E.SubElement(pr, W + "tag").set(W + "val", "jg:key:" + key)
                E.SubElement(pr, W + "lock").set(W + "val", "sdtContentLocked")
                E.SubElement(inserted, W + "sdtContent").append(replacement)
            run.addnext(inserted)
            if suffix is not None and text(suffix):
                inserted.addnext(suffix)


def expand(root, lists):
    for parent in reversed(list(root.iter())):
        while True:
            children = list(parent)
            found = None
            for i, child in enumerate(children):
                match = re.search(r"\{#([^{}]+)\}", text(child))
                if not match:
                    continue
                key = match[1]
                for j in range(i, len(children)):
                    if "{/" + key + "}" in text(children[j]):
                        found = i, j, key
                        break
                if found:
                    break
            if not found:
                break
            i, j, key = found
            # Only repeat block containers, never individual runs/text inside a row.
            if parent.tag not in {W + "body", W + "tbl", W + "tc"}:
                break
            if key not in lists:
                raise ValueError("missing explicit list: " + key)
            originals = children[i:j + 1]
            for child in originals:
                parent.remove(child)
            position = i
            reviewed_table_block = len(originals) == 3 and originals[1].tag == W + "tbl" and text(originals[0]).strip() == "{#" + key + "}" and text(originals[2]).strip() == "{/" + key + "}"
            if any(c.tag == W + "tbl" for c in originals) and not reviewed_table_block:
                raise ValueError("ambiguous table loop block requires explicit mapping")
            if reviewed_table_block:
                table = deepcopy(originals[1])
                data_rows = [r for r in table.findall(W + "tr") if TOKEN.search(text(r))]
                if len(data_rows) != 1:
                    raise ValueError("block table loop needs exactly one reviewed placeholder row")
                data_row = data_rows[0]
                row_index = table.index(data_row)
                for header in list(table)[:row_index]:
                    if header.tag != W + "tr":
                        continue
                    props = header.find(W + "trPr")
                    if props is None:
                        props = E.Element(W + "trPr")
                        header.insert(0, props)
                    if props.find(W + "tblHeader") is None:
                        E.SubElement(props, W + "tblHeader")
                table.remove(data_row)
                for offset, row in enumerate(lists[key]):
                    clone = deepcopy(data_row)
                    substitute(clone, row, False)
                    table.insert(row_index + offset, clone)
                if lists[key]:
                    parent.insert(position, table)
                continue
            for row in lists[key]:
                for original in originals:
                    clone = deepcopy(original)
                    substitute(clone if clone.tag != W + "p" else wrap(clone), {"#" + key: "", "/" + key: "", **row}, False)
                    if clone.tag == W + "p" and not text(clone).strip():
                        continue
                    parent.insert(position, clone)
                    position += 1


def wrap(node):
    container = E.Element("probe")
    container.append(node)
    return container


def pricing_values(pricing, mechanical_total=False):
    modes = {"framework": "框架按单价", "lumpsum": "包干", "unit-price": "按清单单价计价"}
    bases = {"inclusive": "含税", "exclusive": "不含税"}
    if pricing.get("mode") not in modes or pricing.get("basis") not in bases:
        raise ValueError("explicit supported pricing mode and amount basis required")
    total, uppercase = pricing.get("total"), pricing.get("uppercase")
    if total is None:
        amount = "部分金额待确定（非最终总价）" if pricing["mode"] == "framework" else "待确定"
    else:
        if not isinstance(total, str) or not re.fullmatch(r"-?\d+(?:\.\d{1,4})?", total) or not isinstance(uppercase, str) or not uppercase.strip():
            raise ValueError("known amount requires exact decimal string and caller-provided uppercase")
        amount = "人民币" + total + "元（大写：" + uppercase + "）"
    rate, invoice = pricing.get("taxRate"), pricing.get("invoiceKind")
    if rate is not None and (not isinstance(rate, str) or not rate.strip()):
        raise ValueError("unknown tax rate must be null; known display must be explicit")
    if invoice is not None and (not isinstance(invoice, str) or not invoice.strip()):
        raise ValueError("unknown invoice kind must be null")
    display = "合同金额（" + bases[pricing["basis"]] + "）：" + amount
    # Display only caller-authoritative facts; this probe never derives tax or
    # uppercase amounts, and never turns NULL into a zero amount/rate.
    display += "；计价方式：" + modes[pricing["mode"]]
    display += "；税率：" + (rate if rate is not None else "待补充")
    display += "；发票类型：" + (invoice if invoice is not None else "待补充")
    if rate is None:
        display += "（不推算另一金额口径）"
    values = {"语义.金额展示": display, "计价方式": modes[pricing["mode"]], "税率": rate if rate is not None else "待补充", "发票类型": invoice if invoice is not None else "待补充"}
    if mechanical_total:
        # The existing narrow column is specifically tax-inclusive. A caller's
        # exclusive contract total must never be relabelled as its gross value.
        values["语义.含税合计数值"] = total if pricing["basis"] == "inclusive" and total is not None else "待确定"
        values["语义.不含税合计数值"] = total if pricing["basis"] == "exclusive" and total is not None else "待确定"
        if pricing["basis"] == "exclusive":
            values["语义.金额展示"] += "；表内含税合计待确定"
        else:
            values["语义.金额展示"] += "；表内不含税合计待确定"
    return values


def render(parts, request, source_name=None):
    if source_name in {"equipment-rental-v1.docx", "labor-subcontract-v1.docx", "material-purchase-v1.docx"} and "word/settings.xml" not in parts:
        parser = E.XMLParser(resolve_entities=False, no_network=True)
        rels = E.fromstring(parts["word/_rels/document.xml.rels"], parser)
        optional = [item for item in rels if item.get("Type") == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings"]
        if optional:
            if len(optional) != 1 or optional[0].get("Id") != "rIdSettings" or optional[0].get("Target") != "settings.xml" or optional[0].get("TargetMode", "Internal") != "Internal":
                raise ValueError("unreviewed dangling settings relationship")
            relationship_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
            for name, data in parts.items():
                if name.endswith(".xml"):
                    xml = E.fromstring(data, parser)
                    if any(key.startswith(relationship_ns) and value == "rIdSettings" for node in xml.iter() for key, value in node.attrib.items()):
                        raise ValueError("referenced settings part missing")
            rels.remove(optional[0])
            parts["word/_rels/document.xml.rels"] = E.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
    if source_name in {"equipment-rental-v1.docx", "labor-subcontract-v1.docx"}:
        # These two reviewed source packages omit the styles content type.
        # Repair package metadata only; never rewrite styles to satisfy an engine.
        parser = E.XMLParser(resolve_entities=False, no_network=True)
        rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
        relationships = E.fromstring(parts["word/_rels/document.xml.rels"], parser)
        styles = [item for item in relationships if item.get("Type") == rel_type]
        if len(styles) != 1 or styles[0].get("Target") != "styles.xml" or styles[0].get("TargetMode", "Internal") != "Internal" or "word/styles.xml" not in parts:
            raise ValueError("reviewed compact styles relationship missing or ambiguous")
        if E.fromstring(parts["word/styles.xml"], parser).tag != W + "styles":
            raise ValueError("reviewed compact styles part has wrong root")
        ct = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        types = E.fromstring(parts["[Content_Types].xml"], parser)
        declared = [item for item in types if item.get("PartName") == "/word/styles.xml"]
        expected = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
        if types.tag != ct + "Types" or len(declared) > 1 or declared and (declared[0].tag != ct + "Override" or declared[0].get("ContentType") != expected):
            raise ValueError("reviewed compact styles content type conflicts")
        if not declared:
            E.SubElement(types, ct + "Override", {"PartName": "/word/styles.xml", "ContentType": expected})
            parts["[Content_Types].xml"] = E.tostring(types, xml_declaration=True, encoding="UTF-8", standalone=True)
    if source_name in {"equipment-rental-v1.docx", "labor-subcontract-v1.docx", "material-purchase-v1.docx", "generic-contract-v1.docx", "professional-subcontract-v1.docx"}:
        parser = E.XMLParser(resolve_entities=False, no_network=True)
        relationships = E.fromstring(parts["word/_rels/document.xml.rels"], parser)
        rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable"
        font_tables = [item for item in relationships if item.get("Type") == rel_type]
        if len(font_tables) != 1 or font_tables[0].get("Target") != "fontTable.xml" or font_tables[0].get("TargetMode", "Internal") != "Internal" or "word/fontTable.xml" not in parts:
            raise ValueError("reviewed font table relationship missing or ambiguous")
        if E.fromstring(parts["word/fontTable.xml"], parser).tag != W + "fonts":
            raise ValueError("reviewed font table part has wrong root")
        ct = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        types = E.fromstring(parts["[Content_Types].xml"], parser)
        declared = [item for item in types if item.get("PartName") == "/word/fontTable.xml"]
        expected = "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"
        if types.tag != ct + "Types" or len(declared) > 1 or declared and (declared[0].tag != ct + "Override" or declared[0].get("ContentType") != expected):
            raise ValueError("reviewed font table content type conflicts")
        if not declared:
            E.SubElement(types, ct + "Override", {"PartName": "/word/fontTable.xml", "ContentType": expected})
            parts["[Content_Types].xml"] = E.tostring(types, xml_declaration=True, encoding="UTF-8", standalone=True)
    values = dict(request["fields"])
    mechanical = source_name == "equipment-rental-real-v1.docx"
    semantic = pricing_values(request["pricing"], mechanical) if "pricing" in request else None
    if semantic:
        values.update(semantic)
    for name in list(parts):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        root = E.fromstring(parts[name], E.XMLParser(resolve_entities=False, no_network=True))
        if name == "word/document.xml" and source_name in {"equipment-rental-v1.docx", "labor-subcontract-v1.docx", "material-purchase-v1.docx"}:
            # These reviewed compact sources have no parties or signing block.
            # Add authoritative parties in the contract body, not a sidecar;
            # neutral labels deliberately infer no unreviewed legal role.
            for key in ["甲方名称", "乙方名称"]:
                if not isinstance(values.get(key), str) or not values[key].strip():
                    raise ValueError("explicit nonempty compact party fields required")
            body = root.find(W + "body")
            number = "临时编号：{草稿编号}" if source_name == "material-purchase-v1.docx" else "合同编号：{草稿编号}"
            anchors = [p for p in body.findall(W + "p") if text(p) == number]
            if len(anchors) != 1 or "甲方" in text(root) or "乙方" in text(root):
                raise ValueError("reviewed compact party body mapping missing or conflicting")
            following = body[body.index(anchors[0]) + 1] if body.index(anchors[0]) + 1 < len(body) else None
            if following is None or following.tag != W + "p" or text(following) != SEMANTIC_TOTAL_SOURCE[source_name]:
                raise ValueError("reviewed compact party amount position changed")
            previous = anchors[0]
            for label, key in [("甲方：", "甲方名称"), ("乙方：", "乙方名称")]:
                paragraph = E.Element(W + "p")
                props = anchors[0].find(W + "pPr")
                if props is not None:
                    paragraph.append(deepcopy(props))
                run = E.SubElement(paragraph, W + "r")
                run_props = E.SubElement(run, W + "rPr")
                E.SubElement(run_props, W + "rFonts", {W + "ascii": "Times New Roman", W + "hAnsi": "Times New Roman", W + "eastAsia": "仿宋_GB2312"})
                E.SubElement(run_props, W + "sz").set(W + "val", "28")
                E.SubElement(run, W + "t").text = label + "{" + key + "}"
                previous.addnext(paragraph)
                previous = paragraph
        if semantic and name == "word/document.xml":
            literal = SEMANTIC_TOTAL_SOURCE.get(source_name)
            if not literal or text(root).count(literal) != 1:
                raise ValueError("reviewed semantic total mapping must match exactly once")
            if mechanical:
                paragraph = next(p for p in root.iter(W + "p") if literal in text(p))
                table = next(paragraph.iterancestors(W + "tbl"))
                if table.getparent().tag != W + "body":
                    raise ValueError("mechanical pricing requires reviewed top-level table")
                if text(table).count("{不含税总额}") != 1:
                    raise ValueError("reviewed mechanical net total must match exactly once")
                substitute(root, {literal: "{语义.含税合计数值}"}, False, re.compile("(" + re.escape(literal) + ")"))
                substitute(table, {"{不含税总额}": "{语义.不含税合计数值}"}, False, re.compile("(" + re.escape("{不含税总额}") + ")"))
                context = E.Element(W + "p")
                props = E.SubElement(context, W + "pPr")
                E.SubElement(props, W + "pStyle").set(W + "val", "Normal")
                run = E.SubElement(context, W + "r")
                rp = E.SubElement(run, W + "rPr")
                E.SubElement(rp, W + "rFonts", {W + "ascii": "Times New Roman", W + "hAnsi": "Times New Roman", W + "eastAsia": "仿宋_GB2312"})
                E.SubElement(rp, W + "sz").set(W + "val", "28")
                E.SubElement(run, W + "t").text = "{语义.金额展示}"
                table.addnext(context)
            else:
                substitute(root, {literal: "{语义.金额展示}"}, False, re.compile("(" + re.escape(literal) + ")"))
        if name == "word/document.xml" and mechanical and request.get("printProfile") == "a4-portrait":
            tables = [t for t in root.findall(W + "body/" + W + "tbl") if "暂估数量" in text(t)]
            if len(tables) != 1:
                raise ValueError("reviewed mechanical quantity column missing or ambiguous")
            # Confirmed print standard: this reviewed list table has a 9pt
            # minimum. Keep larger type, font families and every other table.
            for size in tables[0].xpath(".//w:rPr/w:sz | .//w:rPr/w:szCs", namespaces=NS):
                if int(size.get(W + "val")) < 18:
                    size.set(W + "val", "18")
            for row in tables[0].findall(W + "tr"):
                before = row.find(W + "trPr/" + W + "gridBefore")
                column = int(before.get(W + "val")) if before is not None else 0
                for cell in row.findall(W + "tc"):
                    span = cell.find(W + "tcPr/" + W + "gridSpan")
                    width = int(span.get(W + "val")) if span is not None else 1
                    if column == 2 and width == 1:
                        props = cell.find(W + "tcPr")
                        if props is None:
                            props = E.Element(W + "tcPr")
                            cell.insert(0, props)
                        margins = props.find(W + "tcMar")
                        if margins is None:
                            margins = E.SubElement(props, W + "tcMar")
                        for side in ["left", "right", "start", "end"]:
                            edge = margins.find(W + side)
                            if edge is None:
                                edge = E.SubElement(margins, W + side)
                            edge.set(W + "w", "40")
                            edge.set(W + "type", "dxa")
                    column += width
        if name == "word/document.xml" and source_name == "material-purchase-real-v1.docx" and request.get("printProfile") == "a4-portrait":
            tables = [table for table in root.findall(W + "body/" + W + "tbl") if len(table.findall(W + "tblGrid/" + W + "gridCol")) == 13 and "货物名称" in text(table) and "价税合计" in text(table)]
            if len(tables) != 1:
                raise ValueError("reviewed material bill table missing or ambiguous")
            for size in tables[0].xpath(".//w:rPr/w:sz | .//w:rPr/w:szCs", namespaces=NS):
                if int(size.get(W + "val")) < 18:
                    size.set(W + "val", "18")
        expand(root, request.get("lists", {}))
        substitute(root, values)
        if name == "word/document.xml" and request.get("printProfile") == "a4-portrait":
            sections = list(root.iter(W + "sectPr"))
            if not sections:
                sections = [E.SubElement(root.find(W + "body"), W + "sectPr")]
            for section in sections:
                size = section.find(W + "pgSz")
                if size is None:
                    size = E.SubElement(section, W + "pgSz")
                size.attrib.clear()
                size.set(W + "w", "11906")
                size.set(W + "h", "16838")
            body = root.find(W + "body")
            # Only inert trailing paragraphs; explicit breaks, fields, bookmarks,
            # drawings and section properties stop trimming. Interior whitespace
            # (including signing space) is never touched.
            while body is not None and len(body) > 1:
                tail = body[-2] if body[-1].tag == W + "sectPr" else body[-1]
                if tail.tag != W + "p" or text(tail).strip():
                    break
                if any(n.tag not in {W + "p", W + "pPr", W + "r", W + "rPr", W + "t"} and not n.xpath("ancestor::w:pPr or ancestor::w:rPr", namespaces=NS) for n in tail.iter()):
                    break
                if tail.find(".//" + W + "sectPr") is not None or tail.find(".//" + W + "pageBreakBefore") is not None:
                    break
                body.remove(tail)
        leftovers = TOKEN.findall(text(root))
        if leftovers:
            raise ValueError("unmapped placeholders: " + ", ".join(sorted(set(leftovers))))
        parts[name] = E.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True) if name == "word/document.xml" or root.xpath(".//w:sdt", namespaces=NS) else parts[name]


def revise(parts, request):
    root = E.fromstring(parts["word/document.xml"], E.XMLParser(resolve_entities=False, no_network=True))
    updates = dict(request.get("fields", {}))
    for key in ["甲方名称", "乙方名称"]:
        if key in updates and (not isinstance(updates[key], str) or not updates[key].strip()):
            raise ValueError("explicit nonempty party fields required")
    tags = set(root.xpath(".//w:sdtPr/w:tag/@w:val", namespaces=NS))
    dependent = {"合同金额", "合同金额大写", "语义.金额展示", "语义.含税合计数值", "语义.不含税合计数值", "计价方式", "税率", "发票类型"}
    if "jg:key:语义.不含税合计数值" in tags:
        dependent.add("不含税总额")
    if "jg:key:语义.金额展示" in tags and set(updates).intersection(dependent):
        raise ValueError("semantic pricing must be synchronized as one authoritative context")
    if "pricing" in request:
        semantic = pricing_values(request["pricing"], "jg:key:语义.含税合计数值" in tags)
        if "jg:key:语义.金额展示" not in tags:
            raise ValueError("pricing sync requires a reviewed semantic anchor")
        updates.update({key: value for key, value in semantic.items() if "jg:key:" + key in tags})
    edit = request.get("edit")
    if edit:
        matches = [p for p in root.iter(W + "p") if text(p) == edit["exactText"]]
        if len(matches) != 1 or matches[0].find(".//" + W + "sdt") is not None:
            raise ValueError("ordinary edit requires one paragraph without authoritative anchors")
        nodes = matches[0].findall(".//" + W + "t")
        nodes[0].text = edit["replacement"]
        for node in nodes[1:]:
            node.text = ""
    for key, value in updates.items():
        controls = root.xpath(".//w:sdt[w:sdtPr/w:tag/@w:val=$tag]", namespaces=NS, tag="jg:key:" + key)
        if not controls:
            raise ValueError("field is not mapped in this document: " + key)
        for control in controls:
            nodes = control.findall(".//" + W + "t")
            nodes[0].text = str(value)
            for node in nodes[1:]:
                node.text = ""
    insertion = request.get("insert")
    if insertion:
        matches = [p for p in root.iter(W + "p") if text(p) == insertion["afterText"]]
        if len(matches) != 1:
            raise ValueError("ordinary clause insertion anchor must be unique")
        paragraph = E.Element(W + "p")
        props = matches[0].find(W + "pPr")
        if props is not None:
            paragraph.append(deepcopy(props))
        run = E.SubElement(paragraph, W + "r")
        rp = E.SubElement(run, W + "rPr")
        E.SubElement(rp, W + "rFonts", {W + "ascii": "Times New Roman", W + "hAnsi": "Times New Roman", W + "eastAsia": "仿宋_GB2312"})
        E.SubElement(rp, W + "sz").set(W + "val", "28")
        E.SubElement(run, W + "t").text = insertion["text"]
        matches[0].addnext(paragraph)
    parts["word/document.xml"] = E.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["render", "revise", "regenerate", "export-pdf"])
    parser.add_argument("--template", type=Path)
    parser.add_argument("--document", type=Path)
    parser.add_argument("--request", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--confirm-discard-manual-clauses", action="store_true")
    parser.add_argument("--converter", default="/Applications/LibreOffice.app/Contents/MacOS/soffice")
    parser.add_argument("--engine", choices=["libreoffice", "docx4j"], default="libreoffice")
    parser.add_argument("--runtime-manifest", type=Path)
    args = parser.parse_args()
    if args.runtime_manifest and args.engine != "docx4j":
        parser.error("runtime manifest requires explicit docx4j engine; no fallback")
    if args.output.exists():
        parser.error("output exists; use a new revision path")
    if args.operation == "export-pdf":
        if not args.document:
            parser.error("document required")
        if args.converter != "/Applications/LibreOffice.app/Contents/MacOS/soffice":
            parser.error("only the pinned local converter is allowed")
        if args.engine == "docx4j":
            if not args.runtime_manifest:
                parser.error("explicit pinned runtime manifest required")
            from docx4j_export import export_pdf
            export_pdf(args.document, args.output, args.runtime_manifest)
            print(json.dumps({"output": args.output.name, "operation": args.operation, "engine": args.engine}))
            return
        with tempfile.TemporaryDirectory(prefix="task08-convert-") as tmp:
            tmp = Path(tmp)
            shutil.copyfile(args.document, tmp / "input.docx")
            result = subprocess.run([args.converter, "-env:UserInstallation=" + (tmp / "profile").as_uri(), "--headless", "--convert-to", 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}', "--outdir", str(tmp), str(tmp / "input.docx")], capture_output=True, timeout=120)
            if result.returncode or not (tmp / "input.pdf").is_file():
                raise ValueError("converter failed to produce PDF: " + str(result.returncode) + ": " + result.stderr.decode(errors="replace")[:500])
            with args.output.open("xb") as target:
                target.write((tmp / "input.pdf").read_bytes())
        print(json.dumps({"output": args.output.name, "operation": args.operation}))
        return
    if not args.request:
        parser.error("request required")
    if args.operation == "regenerate" and (not args.confirm_discard_manual_clauses or not args.document):
        parser.error("template replacement discards manual clauses; explicit confirmation and previous document required")
    source = args.template if args.operation in {"render", "regenerate"} else args.document
    if source is None:
        parser.error("source document required")
    with ZipFile(source) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > 20_000_000:
            raise ValueError("probe source exceeds size bound")
        parts = {name: archive.read(name) for name in archive.namelist()}
    request = json.loads(args.request.read_text())
    if request.get("printProfile") not in {None, "a4-portrait"}:
        raise ValueError("unknown print profile")
    if args.operation == "revise":
        revise(parts, request)
    else:
        render(parts, request, source.name)
    if args.operation == "regenerate":
        with args.output.with_suffix(".previous.docx").open("xb") as snapshot:
            snapshot.write(args.document.read_bytes())
    with args.output.open("xb") as stream, ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, value in parts.items():
            archive.writestr(name, value)
    print(json.dumps({"output": args.output.name, "operation": args.operation}))


if __name__ == "__main__":
    main()
