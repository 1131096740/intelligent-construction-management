"""Read visible page glyphs for the isolated Task12 Word/PDF proof."""

import json
import sys
from collections import Counter
from pathlib import Path

MAX_BYTES = 100_000_000
MAX_PAGES = 100
MAX_CHARACTERS = 500_000


def glyph_key(codepoint, origin):
    return codepoint, round(origin[0], 2), round(origin[1], 2)


def read_pages():
    if len(sys.argv) != 2 or sys.version_info[:3] != (3, 11, 15):
        raise ValueError()
    package = Path(sys.argv[1])
    sys.path.insert(0, str(package))
    import pymupdf

    if pymupdf.VersionBind != "1.26.7" or Path(pymupdf.__file__) != package / "pymupdf" / "__init__.py":
        raise ValueError()
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)

    source = sys.stdin.buffer.read(MAX_BYTES + 1)
    if not source.startswith(b"%PDF-") or len(source) > MAX_BYTES:
        raise ValueError()

    pages = []
    count = 0
    with pymupdf.open(stream=source, filetype="pdf") as pdf:
        if pdf.is_encrypted or not 1 <= len(pdf) <= MAX_PAGES:
            raise ValueError()
        for page in pdf:
            drawn = Counter()
            for span in page.get_texttrace():
                if span["type"] not in (0, 1) or not 0 < span["opacity"] <= 1:
                    continue
                for codepoint, glyph, origin, box in span["chars"]:
                    if glyph <= 0 or not 0 < codepoint <= 0x10FFFF or codepoint == 0xFFFD:
                        continue
                    if not (pymupdf.Rect(box) * page.rotation_matrix).intersects(page.rect):
                        continue
                    count += 1
                    if count > MAX_CHARACTERS:
                        raise ValueError()
                    drawn[glyph_key(codepoint, origin)] += 1
            # Use structured layout for order only. Every emitted character
            # must independently consume an actual painted glyph at its origin.
            text = []
            flags = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_IMAGES
            for block in page.get_text("rawdict", flags=flags)["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        for char in span["chars"]:
                            value = char["c"]
                            if len(value) != 1:
                                continue
                            key = glyph_key(ord(value), char["origin"])
                            if drawn[key] > 0:
                                text.append(value)
                                drawn[key] -= 1
            pages.append("".join(text))
    return pages


try:
    result = json.dumps(read_pages(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(result)
except Exception:
    # The parent consumes only its bounded private pipe and emits a fixed error.
    sys.exit(1)
