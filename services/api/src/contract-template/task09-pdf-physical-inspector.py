"""Task09's bounded real-output test: pinned two-font DOCX/PDF glyph proof.

This is an independent reader, never a converter or a text-extraction substitute.
Exit 1 means a physical predicate failed; exit 2 means inspector/tool failure.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pymupdf
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen

PINS = {
    "FangSong_GB2312.ttf": "fef7cf991b458cabd184b73378918d9d15429010e1d6c804f08d394395c3c3b4",
    "TimesNewRoman.ttf": "f3b4ffff71c2a0c7227d37497683b2498fb2d0a4e8beae26f022e3ccfcaabfa3",
}
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def family_names(font):
    return sorted({n.toUnicode() for n in font["name"].names if n.nameID == 1})


def normalized_name(value):
    return re.sub(r"[^\w]", "", re.sub(r"^[A-Z]{6}\+", "", value)).lower()


def outline(font, gid):
    # Decompose against each program's own glyphset, so subset renaming and
    # composite component IDs cannot affect comparison. Compare in em units.
    glyphs = font.getGlyphSet()
    glyph = glyphs[font.getGlyphOrder()[gid]]
    pen = DecomposingRecordingPen(glyphs)
    glyph.draw(pen)
    bounds = BoundsPen(glyphs)
    glyph.draw(bounds)
    upem = font["head"].unitsPerEm

    def em(value):
        if isinstance(value, (tuple, list)):
            return [em(item) for item in value]
        if isinstance(value, (int, float)):
            return round(value / upem, 10)
        return value

    commands = [(operator, em(points)) for operator, points in pen.value]
    nonempty = (bounds.bounds is not None and
                bounds.bounds[2] > bounds.bounds[0] and
                bounds.bounds[3] > bounds.bounds[1] and
                any(op in {"lineTo", "curveTo", "qCurveTo"} for op, _ in pen.value))
    return digest(json.dumps(commands, separators=(",", ":")).encode()), nonempty


def inspect(args):
    args.out_dir.mkdir(exist_ok=False)
    fonts = {}
    for name, expected in PINS.items():
        value = (args.font_dir / name).read_bytes()
        if digest(value) != expected:
            raise RuntimeError("Locked font copy hash mismatch: " + name)
        fonts[name] = TTFont(BytesIO(value))
    cjk_font, ascii_font = fonts["FangSong_GB2312.ttf"], fonts["TimesNewRoman.ttf"]
    with ZipFile(args.docx) as source:
        xml = ET.fromstring(source.read("word/document.xml"))
        text = "".join(node.text or "" for node in xml.findall(".//w:t", NS))
        declarations = [{key: node.get("{" + NS["w"] + "}" + key)
                         for key in ["ascii", "eastAsia"]}
                        for node in xml.findall(".//w:rFonts", NS)]
    failures = []
    if not declarations or any(item["eastAsia"] not in {"仿宋_GB2312", "FangSong_GB2312"}
                               or item["ascii"] != "Times New Roman" for item in declarations):
        failures.append("DOCX declared font roles differ from the bounded locked fixture")
    expected = Counter(character for character in text if "\u3400" <= character <= "\u9fff")
    if not expected:
        failures.append("No expected Chinese source characters")
    observed, physical = Counter(), defaultdict(set)
    programs, drawings, raster = {}, [], []
    doc = pymupdf.open(args.pdf)
    outline_cache = {}
    for page in doc:
        page_fonts = []
        for item in page.get_fonts(full=True):
            xref = item[0]
            if xref not in programs:
                name, extension, kind, content = doc.extract_font(xref)
                if not content:
                    failures.append("Font has no embedded program: " + item[3])
                    continue
                font = TTFont(BytesIO(content))
                programs[xref] = {"font": font, "basefont": item[3], "names": family_names(font),
                                  "sha256": digest(content), "unitsPerEm": font["head"].unitsPerEm,
                                  "traceNames": {normalized_name(item[3]), normalized_name(name)} |
                                  {normalized_name(n.toUnicode()) for n in font["name"].names if n.nameID in {1, 4, 6}}}
            if xref in programs:
                page_fonts.append((xref, programs[xref]))
        for span in page.get_texttrace():
            candidates = [(xref, program) for xref, program in page_fonts
                          if normalized_name(span["font"]) in program["traceNames"]]
            if len(candidates) != 1:
                raise RuntimeError("Cannot uniquely map actual texttrace font to embedded program: " + span["font"])
            xref, program = candidates[0]
            for codepoint, gid, _origin, bbox in span["chars"]:
                character = chr(codepoint)
                is_cjk = "\u3400" <= character <= "\u9fff"
                is_ascii = 33 <= codepoint <= 126
                if not is_cjk and not is_ascii:
                    continue
                if is_cjk:
                    observed[character] += 1
                source_font = cjk_font if is_cjk else ascii_font
                if not set(program["names"]) & set(family_names(source_font)):
                    failures.append("Actual embedded family mismatches role: " + character)
                if gid == 0 or span["type"] == 3 or span.get("opacity", 1) <= 0:
                    failures.append("Missing or invisible physical glyph: " + character)
                key = (xref, gid)
                if key not in outline_cache:
                    outline_cache[key] = outline(program["font"], gid)
                actual_shape, nonempty = outline_cache[key]
                if not nonempty:
                    failures.append("Empty embedded outline: " + character)
                if is_cjk:
                    source_name = source_font.getBestCmap().get(codepoint)
                    if source_name is None:
                        failures.append("Expected Chinese absent from pinned source font: " + character)
                        continue
                    expected_shape, expected_nonempty = outline(source_font, source_font.getGlyphID(source_name))
                    if not expected_nonempty or actual_shape != expected_shape:
                        failures.append("Chinese outline differs from locked source (em-normalized): " + character)
                    physical[character].add(actual_shape)
                    drawings.append({"character": character, "page": page.number + 1, "font": span["font"],
                                     "gid": gid, "nonempty": nonempty, "shapeSha256": actual_shape,
                                     "sourceShapeSha256": expected_shape})
                if bbox[0] < -1 or bbox[1] < -1 or bbox[2] > page.rect.width + 1 or bbox[3] > page.rect.height + 1:
                    failures.append("Visible glyph outside page: " + character)
        path = args.out_dir / ("page-" + str(page.number + 1) + ".png")
        page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(path)
        raster.append({"path": str(path), "sha256": digest(path.read_bytes())})
    if observed != expected:
        failures.append("Actual physical Chinese character counts differ from generated DOCX")
    shapes = {shape for values in physical.values() for shape in values}
    if len(shapes) != len(expected) or any(len(values) != 1 for values in physical.values()):
        failures.append("Distinct Chinese characters collapse to the same physical outline")
    report = {"docxSha256": digest(args.docx.read_bytes()), "pdfSha256": digest(args.pdf.read_bytes()),
              "lockedFonts": PINS, "declaredFonts": declarations,
              "expectedChineseCount": sum(expected.values()), "actualChineseCount": sum(observed.values()),
              "expectedDistinctChinese": len(expected), "actualDistinctPhysicalChinese": len(shapes),
              "embeddedPrograms": [{key: value for key, value in program.items() if key not in {"font", "traceNames"}}
                                   for program in programs.values()],
              "physicalChineseDrawings": drawings, "rasters": raster,
              "failures": sorted(set(failures)), "verdict": "RED" if failures else "GREEN"}
    (args.out_dir / "receipt.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key not in {"physicalChineseDrawings", "declaredFonts"}}, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for key in ["docx", "pdf", "font-dir", "out-dir"]:
        parser.add_argument("--" + key, type=Path, required=True)
    arguments = parser.parse_args()
    try:
        sys.exit(inspect(arguments))
    except Exception as error:
        arguments.out_dir.mkdir(exist_ok=True)
        (arguments.out_dir / "inspector-error.json").write_text(json.dumps({"verdict": "INSPECTOR_ERROR", "message": str(error)}, ensure_ascii=False, indent=2) + "\n")
        print("INSPECTOR_ERROR: " + str(error), file=sys.stderr)
        sys.exit(2)
