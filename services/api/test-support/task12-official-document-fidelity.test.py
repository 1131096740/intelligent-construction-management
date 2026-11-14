"""Pure in-memory glyph policy tests. No PDF, converter or external resource."""
import importlib.util
from pathlib import Path
import unittest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

spec = importlib.util.spec_from_file_location("official_fidelity", Path(__file__).with_name("task12-official-document-fidelity.py"))
fidelity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fidelity)


def font(scale=1, changed=False, shift=0):
    builder = FontBuilder(1000 * scale, isTTF=True)
    builder.setupGlyphOrder([".notdef", "shape", "combined"])
    builder.setupCharacterMap({0x4e00: "shape", 0x4e01: "combined"})
    empty = TTGlyphPen(None).glyph()
    pen = TTGlyphPen(None)
    pen.moveTo((100 * scale, 100 * scale))
    pen.lineTo(((450 if changed else 400) * scale, 100 * scale))
    pen.lineTo((200 * scale, 600 * scale))
    pen.closePath()
    shape = pen.glyph()
    pen = TTGlyphPen({"shape": shape})
    pen.addComponent("shape", (1, 0, 0, 1, shift, 0))
    builder.setupGlyf({".notdef": empty, "shape": shape, "combined": pen.glyph()})
    builder.setupHorizontalMetrics({".notdef": (1000 * scale, 0), "shape": (1000 * scale, 100 * scale), "combined": (1000 * scale, 100 * scale + shift)})
    return builder.font


class GlyphPolicy(unittest.TestCase):
    def test_drawn_program_binding_keeps_same_family_subsets_distinct(self):
        import io
        import hashlib
        import pymupdf
        def program(changed):
            b = FontBuilder(1000, isTTF=True)
            b.setupGlyphOrder([".notdef", "shape"])
            b.setupCharacterMap({ord("X"): "shape"})
            pen = TTGlyphPen(None)
            pen.moveTo((100, 100)); pen.lineTo((450 if changed else 400, 100)); pen.lineTo((200, 600)); pen.closePath()
            b.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "shape": pen.glyph()})
            b.setupHorizontalMetrics({".notdef": (1000, 0), "shape": (1000, 100)})
            b.setupHorizontalHeader(ascent=800, descent=-200)
            b.setupNameTable({"familyName": "SameFamily", "styleName": "Regular", "uniqueFontIdentifier": "SameFamily", "fullName": "SameFamily", "psName": "SameFamily"})
            b.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
            b.setupPost(); b.setupMaxp()
            out = io.BytesIO(); b.font.save(out); return out.getvalue()
        left, right = program(False), program(True)
        self.assertNotEqual(left, right)
        with pymupdf.open() as doc:
            page = doc.new_page()
            page.insert_font(fontname="left", fontbuffer=left)
            page.insert_font(fontname="right", fontbuffer=right)
            page.insert_text((40, 50), "X", fontname="left")
            page.insert_text((40, 80), "X", fontname="right")
            spans = fidelity.drawn_texttrace(page)
            self.assertEqual([s["fontProgramSha256"] for s in spans], [hashlib.sha256(left).hexdigest(), hashlib.sha256(right).hexdigest()])
            self.assertEqual([s["font"] for s in spans], ["SameFamily", "SameFamily"])

    def test_missing_draw_font_program_is_rejected(self):
        import pymupdf
        with pymupdf.open() as doc:
            page = doc.new_page()
            glyph, face, content = [doc.get_new_xref() for _ in range(3)]
            doc.update_object(glyph, "<<>>")
            doc.update_stream(glyph, b"1000 0 0 0 1000 1000 d1 0 0 500 500 re f")
            doc.update_object(face, "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [.001 0 0 .001 0 0] /CharProcs << /X %d 0 R >> /Encoding << /Type /Encoding /Differences [88 /X] >> /FirstChar 88 /LastChar 88 /Widths [1000] /Resources <<>> >>" % glyph)
            doc.xref_set_key(page.xref, "Resources", "<< /Font << /F1 %d 0 R >> >>" % face)
            doc.update_object(content, "<<>>")
            doc.update_stream(content, b"BT /F1 12 Tf 40 700 Td (X) Tj ET")
            page.set_contents(content)
            with self.assertRaisesRegex(ValueError, "DRAW_FONT_BUFFER"):
                fidelity.drawn_texttrace(page)

    def test_only_exact_bounded_font_metadata_warnings_are_reported(self):
        import logging
        diagnostics = fidelity.FontProgramDiagnostics()
        name = "fontTools.ttLib.tables._h_e_a_d"
        def message(text, level=logging.WARNING, logger=name):
            diagnostics.handle(logging.LogRecord(logger, level, __file__, 1, text, (), None))
        message("'created' timestamp seems very low; regarding as unix timestamp")
        message("'created' timestamp seems very low; regarding as unix timestamp")
        self.assertEqual(diagnostics.rows[0]["count"], 2)
        message("too much 'glyf' table data: expected 100, received 112 bytes", logger="fontTools.ttLib.tables._g_l_y_f")
        for text, level, logger in [("unknown warning", logging.WARNING, name),
                                   ("'created' timestamp seems very low; regarding as unix timestamp", logging.ERROR, name),
                                   ("'created' timestamp seems very low; regarding as unix timestamp suffix", logging.WARNING, name),
                                   ("'created' timestamp seems very low; regarding as unix timestamp", logging.WARNING, "other"),
                                   ("too much 'glyf' table data: expected 100, received 113 bytes", logging.WARNING, "fontTools.ttLib.tables._g_l_y_f")]:
            with self.assertRaisesRegex(ValueError, "FONT_DIAGNOSTIC"):
                message(text, level, logger)
        for _ in range(509):
            message("'created' timestamp seems very low; regarding as unix timestamp")
        with self.assertRaisesRegex(ValueError, "FONT_DIAGNOSTIC"):
            message("'created' timestamp seems very low; regarding as unix timestamp")

    def test_literal_subset_name(self):
        self.assertEqual(fidelity.normalized("ABCDEF+FangSong_GB2312"), "fangsonggb2312")
        self.assertNotEqual(fidelity.normalized("OTHER-FAMILY"), "fangsonggb2312")

    def test_wrong_tounicode_never_changes_which_gid_was_physically_drawn(self):
        original = font()
        actual = font(changed=True)
        # The embedded cmap lies about gid 2. Matching must use draw gid 2,
        # then compare its outline to the original Unicode glyph, not this cmap.
        actual["cmap"].tables[0].cmap[0x4e00] = "combined"
        program = {"font": actual, "glyphs": actual.getGlyphSet(), "order": actual.getGlyphOrder()}
        self.assertFalse(fidelity.drawn_glyph_matches(program, 2, 0x4e00, original))
        self.assertFalse(fidelity.drawn_glyph_matches(program, 0, 0x4e00, original))
        self.assertFalse(fidelity.drawn_glyph_matches(program, 1, 0x4e02, original))

    def test_cff_matrix_is_applied_instead_of_treating_font_units_as_em(self):
        source = font()
        program = {"font": None, "glyphs": source.getGlyphSet(), "matrix": [.001, 0, 0, .001, 0, 0]}
        self.assertEqual(fidelity.glyph_outline(program, "shape"), fidelity.glyph_outline(source, "shape"))
        program["matrix"] = [.002, 0, 0, .001, 0, 0]
        self.assertNotEqual(fidelity.glyph_outline(program, "shape"), fidelity.glyph_outline(source, "shape"))
        program["matrix"] = [float("nan"), 0, 0, .001, 0, 0]
        with self.assertRaises(ValueError):
            fidelity.glyph_outline(program, "shape")

    def test_actual_cff_program_uses_its_declared_matrix_and_draw_gid_order(self):
        from fontTools.pens.t2CharStringPen import T2CharStringPen
        builder = FontBuilder(1000, isTTF=False)
        builder.setupGlyphOrder([".notdef", "shape"])
        builder.setupCharacterMap({0x4e00: "shape"})
        builder.setupHorizontalMetrics({".notdef": (1000, 0), "shape": (1000, 100)})
        empty = T2CharStringPen(1000, None).getCharString()
        pen = T2CharStringPen(1000, None)
        pen.moveTo((100, 100));pen.lineTo((400, 100));pen.lineTo((200, 600));pen.closePath()
        builder.setupCFF("FixedTest", {"FullName": "FixedTest", "FamilyName": "FixedTest", "FontMatrix": [.001, 0, 0, .001, 0, 0]}, {".notdef": empty, "shape": pen.getCharString()}, {})
        program = fidelity.font_program(builder.font["CFF "].compile(builder.font))
        self.assertTrue(fidelity.drawn_glyph_matches(program, 1, 0x4e00, font()))
        program["matrix"] = [.002, 0, 0, .001, 0, 0]
        self.assertFalse(fidelity.drawn_glyph_matches(program, 1, 0x4e00, font()))

    def test_composite_transform_is_not_silently_ignored(self):
        self.assertNotEqual(fidelity.glyph_outline(font(shift=100), "combined"), fidelity.glyph_outline(font(), "shape"))

    def test_same_family_nonempty_different_outline_is_not_the_pinned_glyph(self):
        self.assertNotEqual(fidelity.glyph_outline(font(), "shape"), fidelity.glyph_outline(font(changed=True), "shape"))

    def test_em_scaling_and_composite_decomposition_preserve_the_exact_outline(self):
        expected = fidelity.glyph_outline(font(), "shape")
        self.assertEqual(expected, (("moveTo", ((.1, .1),)), ("lineTo", ((.4, .1),)), ("lineTo", ((.2, .6),)), ("closePath", ())))
        self.assertEqual(expected, fidelity.glyph_outline(font(scale=2), "shape"))
        self.assertEqual(expected, fidelity.glyph_outline(font(), "combined"))
        self.assertNotEqual(expected, fidelity.glyph_outline(font(), ".notdef"))


if __name__ == "__main__":
    unittest.main()
