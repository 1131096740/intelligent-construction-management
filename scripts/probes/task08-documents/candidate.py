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


def text(node):
    return "".join(node.itertext()) if node.tag == W + "t" else "".join(node.xpath(".//w:t/text()", namespaces=NS))


def substitute(root, values, anchors=True):
    for paragraph in list(root.iter(W + "p")):
        nodes = list(paragraph.iter(W + "t"))
        spans, offset = [], 0
        for node in nodes:
            end = offset + len(node.text or "")
            spans.append((offset, end, node))
            offset = end
        for match in reversed(list(TOKEN.finditer("".join(n.text or "" for n in nodes)))):
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


def render(parts, request):
    for name in list(parts):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        root = E.fromstring(parts[name], E.XMLParser(resolve_entities=False, no_network=True))
        expand(root, request.get("lists", {}))
        substitute(root, request["fields"])
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
        leftovers = TOKEN.findall(text(root))
        if leftovers:
            raise ValueError("unmapped placeholders: " + ", ".join(sorted(set(leftovers))))
        parts[name] = E.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True) if name == "word/document.xml" or root.xpath(".//w:sdt", namespaces=NS) else parts[name]


def revise(parts, request):
    root = E.fromstring(parts["word/document.xml"], E.XMLParser(resolve_entities=False, no_network=True))
    edit = request.get("edit")
    if edit:
        matches = [p for p in root.iter(W + "p") if text(p) == edit["exactText"]]
        if len(matches) != 1 or matches[0].find(".//" + W + "sdt") is not None:
            raise ValueError("ordinary edit requires one paragraph without authoritative anchors")
        nodes = matches[0].findall(".//" + W + "t")
        nodes[0].text = edit["replacement"]
        for node in nodes[1:]:
            node.text = ""
    for key, value in request.get("fields", {}).items():
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
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output exists; use a new revision path")
    if args.operation == "export-pdf":
        if not args.document:
            parser.error("document required")
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
    (revise if args.operation == "revise" else render)(parts, request)
    if args.operation == "regenerate":
        with args.output.with_suffix(".previous.docx").open("xb") as snapshot:
            snapshot.write(args.document.read_bytes())
    with args.output.open("xb") as stream, ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, value in parts.items():
            archive.writestr(name, value)
    print(json.dumps({"output": args.output.name, "operation": args.operation}))


if __name__ == "__main__":
    main()
