"""Generate eight real-template pairs and independently inspect actual PDFs."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZipFile

from lxml import etree as E
import pymupdf

HERE = Path(__file__).resolve().parent
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cli(*args):
    subprocess.run([sys.executable, str(HERE / "candidate.py"), *map(str, args)], check=True, timeout=150)


def compact(text):
    return re.sub(r"\s+", "", text)


def inspect(docx, pdf):
    with ZipFile(docx) as z:
        root = E.fromstring(z.read("word/document.xml"))
        paragraphs = ["".join(p.xpath(".//w:t/text()", namespaces=NS)) for p in root.findall(".//w:p", NS)]
        tables = [[len(row.findall("w:tc", NS)) for row in table.findall("w:tr", NS)] for table in root.findall(".//w:tbl", NS)]
    document = pymupdf.open(pdf)
    pages, fonts, bad_boxes = [], {}, []
    extracted = "".join(page.get_text() for page in document)
    traced = "".join(chr(char[0]) for page in document for span in page.get_texttrace() for char in span["chars"])
    for page in document:
        page_text = page.get_text()
        pages.append({"number": page.number + 1, "sizePt": list(page.rect)[2:], "characters": len(compact(page_text)), "rowMarkers": re.findall(r"样张行\d{3}", compact(page_text))})
        for font in page.get_fonts(full=True):
            xref = font[0]
            if xref not in fonts:
                name, extension, kind, content = document.extract_font(xref)
                fonts[xref] = {"basefont": font[3], "name": name, "type": kind, "extension": extension, "embeddedBytes": len(content), "sha256": hashlib.sha256(content).hexdigest() if content else None}
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    box = pymupdf.Rect(span["bbox"])
                    if span["text"].strip() and (box.x0 < -1 or box.y0 < -1 or box.x1 > page.rect.width + 1 or box.y1 > page.rect.height + 1):
                        bad_boxes.append({"page": page.number + 1, "bbox": list(box), "text": span["text"][:30]})
    # Paragraph fragments survive line/page wrapping; page footer insertion can
    # interrupt a paragraph, so also measure the independent character multiset.
    expected = compact("".join(paragraphs))
    actual = compact(extracted)
    missing = Counter(expected) - Counter(actual)
    fragments = [compact(p) for p in paragraphs if len(compact(p)) >= 3]
    absent = [p for p in fragments if p not in actual]
    result = {"docxSha256": digest(docx), "pdfSha256": digest(pdf), "pages": pages, "fonts": list(fonts.values()), "outOfPageText": bad_boxes, "tablesCellCounts": tables, "docxTextCharacters": len(expected), "pdfTextCharacters": len(actual), "missingCharacterCounts": dict(missing), "missingTraceCharacterCounts": dict(Counter(expected) - Counter(compact(traced))), "paragraphsNotContiguousInPdf": absent, "manualClausePresent": "夜间作业须提前两天书面确认" in actual, "allFontsEmbedded": all(f["embeddedBytes"] > 0 for f in fonts.values()), "allPagesA4": all(abs(p["sizePt"][0] - 595.28) < 2 and abs(p["sizePt"][1] - 841.89) < 2 for p in pages)}
    document.close()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=False)
    results = []
    for template in sorted((HERE / "samples").glob("*.docx")):
        folder = args.artifacts / template.stem
        folder.mkdir()
        with ZipFile(template) as z:
            alltext = "".join("".join(E.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.startswith("word/") and n.endswith(".xml"))
        keys = set(re.findall(r"\{([^{}#/]+)\}", alltext))
        fields = {key: "待补充" for key in keys}
        fields.update({"合同名称": "合成技术样张合同", "项目名称": "合成验证项目", "甲方名称": "合成甲方一", "乙方名称": "合成乙方一", "合同编号": "样张-20261105-01", "草稿编号": "样张-20261105-01", "合同金额": "1125.00", "合同金额大写": "人民币壹仟壹佰贰拾伍元整", "文档水印": "技术验证草稿", "付款条款": "按双方确认的实际工作量付款。", "税率": "13", "发票类型": "增值税专用发票", "付款比例": "60", "进度付款比例": "60", "计价方式": "按清单单价计价", "材料含税合计": "1125.00", "材料不含税合计": "995.40", "材料税额合计": "129.60", "不含税总额": "995.40", "税额总计": "129.60", "不含税总额大写": "人民币玖佰玖拾伍元肆角", "税额总计大写": "人民币壹佰贰拾玖元陆角", "租赁开始日期": "2026年11月01日", "租赁结束日期": "2026年11月30日", "计划开工日期": "2026年11月01日", "计划完工日期": "2026年11月30日"})
        lists = {}
        for key in set(re.findall(r"\{#([^{}]+)\}", alltext)):
            count = 45 if key in {"材料清单", "机械租赁清单"} else 3
            lists[key] = [{"序号": str(i), "名称": f"样张行{i:03d}", "规格型号": "标准型", "生产厂家": "合成厂家", "单位": "台" if key == "机械租赁清单" else "件", "数量": "1", "单价": "25.00", "含税单价": "25.00", "不含税单价": "22.12", "不含税金额": "22.12", "含税金额": "25.00", "税率": "13", "税额单价": "2.88", "税额": "2.88", "备注": "合成技术验证", "是否含燃油": "否", "是否带操作人员": "是", "运输路线": "合成地点甲至乙", "车型": "轻型"} for i in range(1, count + 1)]
        request = folder / "render.json"
        request.write_text(json.dumps({"fields": fields, "lists": lists, "printProfile": "a4-portrait"}, ensure_ascii=False, indent=2))
        before = folder / "before.docx"
        cli("render", "--template", template, "--request", request, "--output", before)
        with ZipFile(before) as z:
            root = E.fromstring(z.read("word/document.xml"))
            candidates = [p for p in root.findall("w:body/w:p", NS) if "".join(p.xpath(".//w:t/text()", namespaces=NS)).strip() and p.find(".//w:sdt", NS) is None]
            anchor = "".join(candidates[0].xpath(".//w:t/text()", namespaces=NS))
            available = set(root.xpath(".//w:sdtPr/w:tag/@w:val", namespaces=NS))
        revision = {key: value for key, value in {"甲方名称": "合成甲方二", "乙方名称": "合成乙方二", "合同名称": "合成技术样张修订合同", "合同金额": "2250.00", "合同金额大写": "人民币贰仟贰佰伍拾元整"}.items() if "jg:key:" + key in available}
        request = folder / "insert.json"
        request.write_text(json.dumps({"insert": {"afterText": anchor, "text": "新增约定：夜间作业须双方书面确认。"}}, ensure_ascii=False))
        inserted = folder / "inserted.docx"
        cli("revise", "--document", before, "--request", request, "--output", inserted)
        request = folder / "edit.json"
        request.write_text(json.dumps({"edit": {"exactText": "新增约定：夜间作业须双方书面确认。", "replacement": "新增约定：夜间作业须提前两天书面确认。"}}, ensure_ascii=False))
        edited = folder / "edited.docx"
        cli("revise", "--document", inserted, "--request", request, "--output", edited)
        request = folder / "sync.json"
        request.write_text(json.dumps({"fields": revision}, ensure_ascii=False))
        after = folder / "after.docx"
        cli("revise", "--document", edited, "--request", request, "--output", after)
        inspections = {}
        for name, docx in [("before", before), ("after", after)]:
            pdf = folder / (name + ".pdf")
            cli("export-pdf", "--document", docx, "--output", pdf)
            inspections[name] = inspect(docx, pdf)
        with ZipFile(template) as original, ZipFile(after) as final:
            untouched = [n for n in original.namelist() if n != "word/document.xml" and not re.search(rb"\{[^{}]+\}", original.read(n))]
            unchanged = all(original.read(n) == final.read(n) for n in untouched)
        results.append({"template": template.name, "sourceSha256": digest(template), "fixedPartsByteIdentical": unchanged, "inspections": inspections})
        (args.artifacts / "comparison.json").write_text(json.dumps({"results": results}, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"template": template.name, "pages": [len(inspections[n]["pages"]) for n in ["before", "after"]], "embedded": inspections["after"]["allFontsEmbedded"], "a4": inspections["after"]["allPagesA4"], "missing": inspections["after"]["missingCharacterCounts"], "badBoxes": len(inspections["after"]["outOfPageText"])}, ensure_ascii=False), flush=True)
    failures = []
    for result in results:
        for stage, inspection in result["inspections"].items():
            if inspection["missingCharacterCounts"] or inspection["outOfPageText"] or not inspection["allFontsEmbedded"] or not inspection["allPagesA4"]:
                failures.append({"template": result["template"], "stage": stage, "missing": inspection["missingCharacterCounts"], "missingTrace": inspection["missingTraceCharacterCounts"], "a4": inspection["allPagesA4"]})
    (args.artifacts / "comparison.json").write_text(json.dumps({"overall": "needs-work" if failures else "measured-checks-only-pass", "limitations": ["same LibreOffice engine imports Word and exports PDF; native Microsoft Word pagination NOT VERIFIED", "character counts can be masked by repeated headers; never an exact full-text equivalence proof", "no legal or physical-device acceptance"], "failures": failures, "results": results}, ensure_ascii=False, indent=2) + "\n")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
