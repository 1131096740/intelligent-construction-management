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


def pricing_values(pricing):
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
    return {"语义.金额展示": display, "计价方式": modes[pricing["mode"]], "税率": rate if rate is not None else "待补充", "发票类型": invoice if invoice is not None else "待补充"}


def render(parts, request, source_name=None):
    values = dict(request["fields"])
    semantic = pricing_values(request["pricing"]) if "pricing" in request else None
    if semantic:
        values.update(semantic)
    for name in list(parts):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        root = E.fromstring(parts[name], E.XMLParser(resolve_entities=False, no_network=True))
        if semantic and name == "word/document.xml":
            literal = SEMANTIC_TOTAL_SOURCE.get(source_name)
            if not literal or text(root).count(literal) != 1:
                raise ValueError("reviewed semantic total mapping must match exactly once")
            substitute(root, {literal: "{语义.金额展示}"}, False, re.compile("(" + re.escape(literal) + ")"))
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
    tags = set(root.xpath(".//w:sdtPr/w:tag/@w:val", namespaces=NS))
    if "jg:key:语义.金额展示" in tags and set(updates).intersection({"合同金额", "合同金额大写", "语义.金额展示", "计价方式", "税率", "发票类型"}):
        raise ValueError("semantic pricing must be synchronized as one authoritative context")
    if "pricing" in request:
        semantic = pricing_values(request["pricing"])
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
