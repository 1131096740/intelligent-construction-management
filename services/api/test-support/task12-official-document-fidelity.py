"""Independent, bounded physical inspection for one fixed fictional document.
No converter/database/network access. Invoked only by the sealed qualification
controller after its complete source/build/material checks.
"""
import collections
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import zipfile
import xml.etree.ElementTree as ET

ANCHOR = "2.本合同的数量为暂估，以实际交货并经验收合格的数量为准，当合同执行数量不能达到合同签订量时，以合同执行数量结算，卖方自愿承担合同签订量未发生部分的风险。"
PROFILE = "TASK12_OFFICIAL_TEMURIN17_0_17_10_V1"
MAX_PDF = 100_000_000
MAX_GLYPHS = 500_000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(text):
    return re.sub(r"[\s_+\-]", "", re.sub(r"^[A-Z]{6}\+", "", text)).lower()


def font_program(data):
    """Keep the embedded program's order: texttrace gid is never a cmap lookup."""
    from fontTools.ttLib import TTFont
    if data[:4] in (b"OTTO", b"\x00\x01\x00\x00", b"true"):
        font = TTFont(io.BytesIO(data))
        names = {normalized(value.toUnicode()) for value in font["name"].names if value.nameID in (1, 4, 6)}
        return {"font": font, "glyphs": font.getGlyphSet(), "order": font.getGlyphOrder(), "names": names}
    from fontTools.cffLib import CFFFontSet
    cff = CFFFontSet()
    cff.decompile(io.BytesIO(data), None)
    if len(cff.fontNames) != 1:
        raise ValueError("FONT_PROGRAM")
    top = cff[cff.fontNames[0]]
    names = {normalized(str(value)) for value in (cff.fontNames[0], getattr(top, "FamilyName", ""), getattr(top, "FullName", "")) if value}
    return {"font": None, "glyphs": top.CharStrings, "order": top.charset, "names": names,
            "matrix": getattr(top, "FontMatrix", [.001, 0, 0, .001, 0, 0]), "cff": top}


def glyph_outline(font, name):
    # Same decomposition principle as the existing task09 physical inspector,
    # extended to CFF's explicit FontMatrix. Compare actual paths in em units.
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.boundsPen import BoundsPen
    import math
    program = font if isinstance(font, dict) else {"font": font, "glyphs": font.getGlyphSet()}
    glyphs, original = program["glyphs"], program["font"]
    top = program.get("cff")
    if original is None:
        matrix = program["matrix"]
    else:
        units = original["head"].unitsPerEm
        if not 16 <= units <= 16384:
            raise ValueError("FONT_UNITS")
        matrix = [1 / units, 0, 0, 1 / units, 0, 0]
        if "CFF " in original:
            top = original["CFF "].cff.topDictIndex[0]
            matrix = getattr(top, "FontMatrix", matrix)
    # The selected locked originals are TrueType. A CID program with an
    # additional per-FD transform is outside this fixed inspector's contract;
    # fail closed rather than accidentally ignoring a second coordinate system.
    if top is not None and hasattr(top, "FDArray") and any("FontMatrix" in getattr(fd, "rawDict", {}) for fd in top.FDArray):
        raise ValueError("UNSUPPORTED_CID_FONT_MATRIX")
    if len(matrix) != 6 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in matrix):
        raise ValueError("FONT_MATRIX")
    pen = DecomposingRecordingPen(glyphs)
    glyphs[name].draw(pen)
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    if len(pen.value) > 50_000:
        raise ValueError("GLYPH_OUTLINE_BOUND")
    if bounds.bounds is None or bounds.bounds[2] <= bounds.bounds[0] or bounds.bounds[3] <= bounds.bounds[1] or not any(operation in {"lineTo", "curveTo", "qCurveTo"} for operation, _ in pen.value):
        return ()
    def coordinate(value):
        if value is None:
            return None
        x, y = value
        xx, xy, yx, yy, dx, dy = matrix
        return (round(xx * x + yx * y + dx, 10), round(xy * x + yy * y + dy, 10))
    return tuple((operation, tuple(coordinate(value) for value in arguments)) for operation, arguments in pen.value)


def drawn_glyph_matches(program, gid, codepoint, original):
    """Actual PDF draw gid versus pinned original Unicode outline, not ToUnicode."""
    if not 0 < gid < len(program["order"]):
        return False
    source_name = original.getBestCmap().get(codepoint)
    if source_name is None:
        return False
    actual = glyph_outline(program, program["order"][gid])
    return bool(actual) and actual == glyph_outline(original, source_name)


def regular(name, expected, limit):
    path = Path(name)
    before = path.lstat()
    if not path.is_absolute() or path.resolve() != path or not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        raise ValueError("INPUT_PATH")
    data = path.read_bytes()
    after = path.lstat()
    if digest(data) != expected or any(getattr(before, key) != getattr(after, key) for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_mode")):
        raise ValueError("INPUT_CHANGED")
    return data


def main():
    if len(sys.argv) != 3 or sys.version_info[:3] != (3, 11, 15):
        raise ValueError("ARGUMENTS")
    request_data = regular(sys.argv[1], sys.argv[2], 128 * 1024)
    request = json.loads(request_data)
    if set(request) != {"version", "profile", "pythonSite", "pdfPath", "pdfSha256", "docxPath", "docxSha256", "outputDirectory", "fonts"} or request["version"] != 1 or request["profile"] != PROFILE:
        raise ValueError("PROFILE")
    site = Path(request["pythonSite"])
    if site.resolve() != site or not site.is_relative_to(Path("/private/tmp")):
        raise ValueError("PACKAGE")
    sys.path.insert(0, str(site))
    import pymupdf
    import fontTools
    from fontTools.ttLib import TTFont
    if pymupdf.VersionBind != "1.26.7" or Path(pymupdf.__file__) != site / "pymupdf" / "__init__.py" or fontTools.__version__ != "4.60.1" or Path(fontTools.__file__) != site / "fontTools" / "__init__.py":
        raise ValueError("PACKAGE")
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    pymupdf.TOOLS.set_subset_fontnames(True)
    pdf_bytes = regular(request["pdfPath"], request["pdfSha256"], MAX_PDF)
    docx_bytes = regular(request["docxPath"], request["docxSha256"], 20_000_000)
    output = Path(request["outputDirectory"])
    info = output.lstat()
    if output.resolve() != output or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("OUTPUT")
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as package:
        if sum(entry.file_size for entry in package.infolist()) > 20_000_000:
            raise ValueError("DOCX_BOUND")
        declarations = []
        for name in ["word/document.xml"]:
            data = package.read(name)
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise ValueError("DOCX_ENTITY")
            tree = ET.fromstring(data)
            for element in tree.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts"):
                declarations.append({key.rsplit("}", 1)[-1]: value for key, value in element.attrib.items()})
    known_fonts = []
    for entry in request["fonts"]:
        data = regular(entry["path"], entry["sha256"], 64 * 1024 * 1024)
        font = TTFont(io.BytesIO(data))
        names = {normalized(value.toUnicode()) for value in font["name"].names if value.nameID in (1, 4, 6)}
        known_fonts.append((names, font))
    allowed = set().union(*(names for names, _ in known_fonts))
    for declaration in declarations:
        for key in ("eastAsia", "ascii", "hAnsi"):
            if declaration.get(key) and normalized(declaration[key]) not in allowed:
                raise ValueError("UNPINNED_DECLARED_FONT")
    def allowed_faces(attribute):
        result = set()
        for name in {entry[attribute] for entry in declarations if entry.get(attribute)}:
            matches = [names for names, _ in known_fonts if normalized(name) in names]
            if not matches:
                raise ValueError("UNPINNED_DECLARED_FONT")
            result.update(set().union(*matches))
        return result
    allowed_cjk, allowed_ascii = allowed_faces("eastAsia"), allowed_faces("ascii")
    report = {"version": 1, "pdfSha256": request["pdfSha256"], "pages": [], "a4Portrait": True,
              "outOfPageGlyphs": 0, "unembeddedFonts": 0, "badGlyphs": 0, "substitutionFonts": 0,
              "paintedChineseGlyphs": 0, "bodyAnchor": {"matches": 0, "lineSpacings": [], "fontSizes": [], "fontFamilies": []}, "failures": []}
    ordered = []
    outline_cache = {}
    def outline(font, name):
        key = (id(font), name)
        if key not in outline_cache:
            outline_cache[key] = glyph_outline(font, name)
        return outline_cache[key]
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
        if pdf.is_encrypted or not 1 <= len(pdf) <= 100:
            raise ValueError("PDF_BOUND")
        report["pageCount"] = len(pdf)
        glyph_count = 0
        for number, page in enumerate(pdf):
            report["a4Portrait"] &= abs(page.rect.width - 595.3) <= 2 and abs(page.rect.height - 841.9) <= 2
            embedded = {}
            for resource in page.get_fonts(full=True):
                if not resource[0]:
                    continue
                data = pdf.extract_font(resource[0])[3]
                if not data:
                    report["unembeddedFonts"] += 1
                    continue
                program = font_program(data)
                trace_names = program["names"] | {normalized(resource[3]), normalized(pdf.extract_font(resource[0])[0])}
                for name in trace_names:
                    embedded.setdefault(name, []).append(program)
            drawn = collections.defaultdict(list)
            for span in page.get_texttrace():
                color = span.get("color", (0,))
                if span["type"] not in (0, 1) or not 0 < span["opacity"] <= 1 or color and all(channel >= .98 for channel in color):
                    continue
                for codepoint, glyph, origin, box in span["chars"]:
                    glyph_count += 1
                    if glyph_count > MAX_GLYPHS:
                        raise ValueError("GLYPH_BOUND")
                    if not 0 < codepoint <= 0x10FFFF or codepoint == 0xFFFD:
                        report["badGlyphs"] += 1
                        continue
                    is_chinese = 0x3400 <= codepoint <= 0x9fff
                    fonts = embedded.get(normalized(span["font"]), [])
                    families = set()
                    if is_chinese or chr(codepoint).isascii() and chr(codepoint).isalnum():
                        if is_chinese:
                            report["paintedChineseGlyphs"] += 1
                        if len(fonts) != 1 or not 0 < glyph < len(fonts[0]["order"]):
                            report["badGlyphs"] += 1
                        else:
                            program = fonts[0]
                            families = program["names"]
                            allowed_faces_for_glyph = allowed_cjk if is_chinese else allowed_ascii
                            if not families or not families <= allowed_faces_for_glyph:
                                report["substitutionFonts"] += 1
                            actual_outline = outline(program, program["order"][glyph])
                            original_outlines = [outline(original, original.getBestCmap()[codepoint])
                                                 for names, original in known_fonts if names & families and codepoint in original.getBestCmap()]
                            if not actual_outline:
                                report["badGlyphs"] += 1
                            if not actual_outline or actual_outline not in original_outlines:
                                report["substitutionFonts"] += 1
                    rectangle = pymupdf.Rect(box) * page.rotation_matrix
                    if rectangle.x0 < -1 or rectangle.y0 < -1 or rectangle.x1 > page.rect.width + 1 or rectangle.y1 > page.rect.height + 1:
                        if is_chinese:
                            report["outOfPageGlyphs"] += 1
                        continue
                    if glyph > 0:
                        key = (codepoint, round(origin[0], 2), round(origin[1], 2))
                        drawn[key].append({"character": chr(codepoint), "page": number, "y": origin[1], "size": span["size"], "families": sorted(families)})
            text = []
            flags = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_IMAGES
            for block in page.get_text("rawdict", flags=flags)["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        for character in span["chars"]:
                            if len(character["c"]) != 1:
                                continue
                            key = (ord(character["c"]), round(character["origin"][0], 2), round(character["origin"][1], 2))
                            if drawn[key]:
                                value = drawn[key].pop()
                                text.append(character["c"])
                                if not character["c"].isspace():
                                    ordered.append(value)
            report["pages"].append("".join(text))
            image = output / ("page-%03d.png" % (number + 1))
            if image.exists():
                raise ValueError("OUTPUT_EXISTS")
            page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(image)
    all_text = "".join(value["character"] for value in ordered)
    starts = [match.start() for match in re.finditer(re.escape(ANCHOR), all_text)]
    anchor = report["bodyAnchor"]
    anchor["matches"] = len(starts)
    if len(starts) == 1:
        values = ordered[starts[0]:starts[0] + len(ANCHOR)]
        origins = sorted({(value["page"], round(value["y"], 2)) for value in values})
        anchor["lineSpacings"] = [round(right[1] - left[1], 2) for left, right in zip(origins, origins[1:]) if left[0] == right[0]]
        cjk = [value for value in values if 0x3400 <= ord(value["character"]) <= 0x9fff]
        anchor["fontSizes"] = sorted({round(value["size"], 2) for value in cjk})
        # Embedded name tables may list full and PostScript names for one face.
        # Require the fixed body face, not a union of every approved CJK family.
        anchor["fontFamilies"] = sorted({"fangsonggb2312" if "fangsonggb2312" in value["families"] else "/".join(value["families"]) for value in cjk})
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("TASK12_OFFICIAL_DOCUMENT_FIDELITY_INSPECTION\n")
        sys.exit(1)
