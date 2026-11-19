"""Owned physical-artifact observation: the unified table's totals must stay on one line."""
import sys, json, hashlib, re
from pathlib import Path
import pymupdf

pdf_path, output_path = map(Path, sys.argv[1:3])
expected = sys.argv[3:]
if len(expected) != 3:
    raise ValueError("Supply the three independently worked net/tax/gross literals")
document = pymupdf.open(pdf_path)
anchors = [(index, rectangle) for index, page in enumerate(document) for rectangle in page.search_for("清单合计")]
observations = {"pdfSha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(), "expected": expected,
                "captionMatches": len(anchors), "pageCount": len(document), "failures": []}
if len(anchors) != 1:
    observations["failures"].append("Unified total-row caption is not unique")
else:
    index, anchor = anchors[0]
    page = document[index]
    horizontal = []
    for path in page.get_drawings():
        for item in path["items"]:
            if item[0] == "l":
                a, b = item[1], item[2]
                if a.y == b.y:
                    horizontal.append((min(a.x, b.x), max(a.x, b.x), a.y))
            elif item[0] == "re":
                rectangle = item[1]
                horizontal.extend([(rectangle.x0, rectangle.x1, rectangle.y0), (rectangle.x0, rectangle.x1, rectangle.y1)])
    center = (anchor.y0 + anchor.y1) / 2
    # FOP can paint one horizontal cell edge as adjacent column segments.
    # Intersect the unique caption's center ray, not an assumed single wide stroke.
    ray = (anchor.x0 + anchor.x1) / 2
    borders = [y for left, right, y in horizontal if left <= ray <= right]
    above, below = [y for y in borders if y < center], [y for y in borders if y > center]
    if not above or not below:
        observations["failures"].append("Could not independently bound the total row by its painted caption-cell borders")
    else:
        top, bottom = max(above), min(below)
        lines = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                midpoint = (line["bbox"][1] + line["bbox"][3]) / 2
                if top < midpoint < bottom:
                    text = "".join(span["text"] for span in line["spans"])
                    lines.append({"text": text, "normalized": re.sub(r"\s", "", text), "bbox": line["bbox"],
                                  "spans": [{"text": s["text"], "origin": s["origin"], "bbox": s["bbox"], "font": s["font"], "size": s["size"]} for s in line["spans"]]})
        matched = {value: [i for i, line in enumerate(lines) if value in line["normalized"]] for value in expected}
        observations.update({"page": index + 1, "captionBBox": list(anchor), "totalRowPaintedY": [top, bottom], "actualLines": lines, "matches": matched})
        for value, matches in matched.items():
            if len(matches) != 1:
                observations["failures"].append("Total must occur intact on exactly one physical line inside the total row: " + value)
observations["verdict"] = "GREEN" if not observations["failures"] else "RED"
output_path.write_text(json.dumps(observations, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"verdict": observations["verdict"], "failures": observations["failures"]}, ensure_ascii=False))
sys.exit(0 if observations["verdict"] == "GREEN" else 1)
