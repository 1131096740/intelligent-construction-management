"""A09 counterexamples: preserve unknowns, expose inherited false headings."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile

import pymupdf
from lxml import etree as E
from run_comparison import HERE, cli, digest, compact


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-request", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=False)
    baseline = json.loads(args.baseline_request.read_text())
    outcomes = []
    cases = [
        ("framework-unknown-total", "", "", "含税", "框架数量及最终总价待确定，清单金额仅为部分金额。"),
        ("lumpsum-no-quantity", "1500.00", "人民币壹仟伍佰元整", "含税", "包干约定，数量不适用。"),
        ("untaxed-unknown-rate", "1500.00", "人民币壹仟伍佰元整", "不含税", "本合同金额口径为不含税，税率待补充，不推算含税金额。"),
    ]
    for name, amount, uppercase, basis, note in cases:
        folder = args.artifacts / name
        folder.mkdir()
        request = json.loads(json.dumps(baseline))
        request["fields"].update({"合同金额": amount, "合同金额大写": uppercase, "税率": "", "发票类型": "待补充", "计价方式": "包干" if name.startswith("lumpsum") else "框架按单价", "付款条款": note})
        request["lists"] = {"通用清单": []}
        path = folder / "request.json"
        path.write_text(json.dumps(request, ensure_ascii=False, indent=2))
        docx, pdf = folder / "actual.docx", folder / "actual.pdf"
        cli("render", "--template", HERE / "samples/generic-contract-v1.docx", "--request", path, "--output", docx)
        cli("export-pdf", "--document", docx, "--output", pdf)
        with ZipFile(docx) as z:
            root = E.fromstring(z.read("word/document.xml"))
            paragraphs = ["".join(p.itertext()) for p in root.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p")]
        with pymupdf.open(pdf) as output:
            actual = compact("".join(page.get_text() for page in output))
        pricing = [p for p in paragraphs if "合同金额（含税）" in compact(p)]
        outcomes.append({"case": name, "expectedAmountBasis": basis, "docxSha256": digest(docx), "pdfSha256": digest(pdf), "unknownRateNotCoercedToZero": "适用税率：。" in actual, "inheritedPricingParagraph": pricing, "mismatch": "模板仍声称最终合同金额但值为空" if not amount else ("不含税说明与固定含税标题冲突" if basis == "不含税" else None), "status": "needs-work" if not amount or basis == "不含税" else "limited-literal-check-only"})
    (args.artifacts / "pricing-cases.json").write_text(json.dumps({"outcomes": outcomes, "overall": "needs-work"}, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
