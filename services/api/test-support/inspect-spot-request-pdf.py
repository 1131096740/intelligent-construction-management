"""Inspect the actual task19 PDFKit output; semantic text alone is not glyph proof.
Uses the pinned PyMuPDF/fontTools versions in task08 requirements. No converter,
font installation, database or network calls. Arguments: PDF, known|unknown, output.
"""
import io, json, hashlib, sys
from pathlib import Path
import pymupdf
from fontTools.ttLib import TTFont
from fontTools.cffLib import CFFFontSet
from fontTools.pens.recordingPen import RecordingPen

pdf_path, kind, output = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
if kind not in ["known", "unknown"]: raise ValueError("Explicit fixture kind required")
output.mkdir(parents=True, exist_ok=False)
pdf = pymupdf.open(pdf_path)
failures, programs, empty, zero, invisible, checked = [], [], [], [], [], set()
for page_no, page in enumerate(pdf):
    fonts = {}
    for font in page.get_fonts(full=True):
        if not font[0]: continue
        _, _, _, data = pdf.extract_font(font[0])
        if not data: failures.append("UNEMBEDDED_FONT"); continue
        if data[:4] in [b"OTTO", b"\x00\x01\x00\x00", b"true"]:
            tt = TTFont(io.BytesIO(data))
            names = {n.toUnicode() for n in tt["name"].names if n.nameID in [1, 4, 6]}
            outlines = tt.getGlyphSet()
            order = tt.getGlyphOrder()
        else:
            cff = CFFFontSet()
            cff.decompile(io.BytesIO(data), None)
            top = cff[cff.fontNames[0]]
            names = set(cff.fontNames)
            outlines, order = top.CharStrings, top.charset
        # PDFKit and the later watermark can embed separate subsets with the same
        # family name. Keep every program instead of silently overwriting one.
        fonts.setdefault(font[3].split("+")[-1], []).append((outlines, order))
        programs.append({"page": page_no + 1, "baseFont": font[3], "names": sorted(names), "sha256": hashlib.sha256(data).hexdigest()})
    for span in page.get_texttrace():
        for char in span["chars"]:
            code, gid = char[0], char[1]
            if not (0x3400 <= code <= 0x9fff or chr(code).isascii() and chr(code).isalnum()): continue
            if span["type"] == 3: invisible.append({"code": code, "glyph": gid})
            if gid == 0: zero.append({"code": code, "glyph": gid}); continue
            candidates = fonts.get(span["font"])
            if candidates is None: failures.append("UNMAPPED_EMBEDDED_FONT"); continue
            outlines_found = []
            for outlines, order in candidates:
                if gid >= len(order): continue
                pen = RecordingPen()
                outlines[order[gid]].draw(pen)
                outlines_found.append(bool(pen.value))
            if not any(outlines_found): empty.append({"code": code, "glyph": gid})
            checked.add((span["font"], gid))
    if abs(page.rect.width - 595.28) > 1 or abs(page.rect.height - 841.89) > 1: failures.append("NOT_A4_PORTRAIT")
    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(output / f"page-{page_no+1}.png")
if len(pdf) != 1: failures.append("UNEXPECTED_PAGINATION")
if empty: failures.append("EMPTY_VISIBLE_GLYPH_OUTLINE")
if zero: failures.append("NOTDEF_GLYPH_ZERO")
if invisible: failures.append("INVISIBLE_TEXT")
text = "\n".join(page.get_text() for page in pdf)
targets = ["12.3456", "米", "2026-07-18"] if kind == "known" else ["待确定"]
positions = []
for target in targets:
    found = [(i, rect) for i, page in enumerate(pdf) for rect in page.search_for(target)]
    expected = 3 if kind == "unknown" else 1
    if len(found) != expected: failures.append("TARGET_COUNT_MISMATCH:" + target)
    for i, rect in found:
        pix = pdf[i].get_pixmap(matrix=pymupdf.Matrix(2, 2), clip=rect, colorspace=pymupdf.csGRAY)
        dark = sum(v < 200 for v in pix.samples)
        if dark < 10: failures.append("EMPTY_TARGET_RASTER:" + target)
        positions.append({"target": target, "page": i+1, "rectangle": list(rect), "darkPixels": dark})
if kind == "known" and "待确定" in text: failures.append("KNOWN_VALUE_REPLACED")
if any(word in text for word in ["null", "undefined", "NaN"]): failures.append("RAW_UNKNOWN_TOKEN")
receipt = {"verdict": "RED" if failures else "GREEN", "failures": failures, "kind": kind, "pdf": str(pdf_path), "pdfSha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(), "pageCount": len(pdf), "physicalDistinctGlyphs": len(checked), "emptyOutlines": empty, "notdef": zero, "invisible": invisible, "programs": programs, "visibleTargets": positions, "semanticText": text}
(output / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({k: receipt[k] for k in ["verdict", "kind", "physicalDistinctGlyphs", "pdfSha256", "failures"]}, ensure_ascii=False))
if failures: sys.exit(1)
