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
