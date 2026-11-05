"""Actual public CLI export; independent PDF checks, no converter mocks."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import pymupdf

HERE = Path(__file__).resolve().parent
TOOLS = Path("/private/tmp/jg-task08-docx4j-tools-20261105")


class PublicExport(unittest.TestCase):
    def test_mechanical_nine_point_layout_in_actual_public_cli_pdf(self):
        from run_comparison import inspect
        folder = Path("/private/tmp/jg-task08-document-receipts-20261105/mechanical-nine-point-single")
        measured = inspect(folder / "actual.docx", folder / "actual.pdf")
        self.assertEqual(measured["missingCharacterCounts"], {})
        self.assertEqual(measured["missingTraceCharacterCounts"], {})
        self.assertEqual(measured["physicalGlyphCandidates"], [])
        self.assertEqual(len(measured["sourceContextCheckboxes"]), 2)
        self.assertTrue(measured["allFontsEmbedded"] and measured["allPagesA4"])
        self.assertEqual(measured["outOfPageText"], [])
        receipt = json.loads((folder / "actual.export.json").read_text())
        self.assertEqual(receipt["conversionCalls"], 1)
        self.assertTrue(receipt["networkAndOutsideFileDenied"])
        with pymupdf.open(folder / "actual.pdf") as document:
            self.assertEqual(len(document), 12)
            lines = [line for block in document[1].get_text("dict")["blocks"] for line in block.get("lines", [])]
            quantities = [line for line in lines if "1.000" in "".join(s["text"] for s in line["spans"])]
            self.assertEqual(len(quantities), 3)
            for line in quantities:
                self.assertEqual("".join(s["text"] for s in line["spans"]), "1.0000")
                self.assertEqual([s["size"] for s in line["spans"]], [9.0])
            table_box = document[1].get_drawings()[0]["rect"]
            sizes = [s["size"] for line in lines for s in line["spans"] if table_box.contains(pymupdf.Rect(s["bbox"])) and s["text"].strip()]
            self.assertGreaterEqual(min(sizes), 9.0)
            body = re.sub(r"\s+", "", "".join(p.get_text() for p in document))
            self.assertIn("合同金额（含税）：人民币75.0000元", body)
            self.assertIn("表内不含税合计待确定", body)
            self.assertNotIn("66.3717", body)
            self.assertIn("单位名称（章）", document[-1].get_text())

    def test_original_checkboxes_require_exact_source_context(self):
        from run_comparison import inspect
        folder = Path("/private/tmp/jg-task08-document-receipts-20261105/public-matrix18-20261105/01-equipment-rental-real-v1-before")
        actual = inspect(folder / "actual.docx", folder / "actual.pdf")
        self.assertEqual(actual["physicalGlyphCandidates"], [])
        self.assertEqual(len(actual["sourceContextCheckboxes"]), 2)
        self.assertTrue(all(item["glyph"] != 0 for item in actual["sourceContextCheckboxes"]))
        with tempfile.TemporaryDirectory(prefix="task08-checkbox-negative-") as tmp:
            mismatch = Path(tmp) / "different-source.docx"
            with ZipFile(folder / "actual.docx") as original, ZipFile(mismatch, "w") as changed:
                for name in original.namelist():
                    data = original.read(name)
                    if name == "word/document.xml":
                        data = data.replace("□".encode(), b"", 1)
                    changed.writestr(name, data)
            rejected = inspect(mismatch, folder / "actual.pdf")
            self.assertEqual(len(rejected["physicalGlyphCandidates"]), 2)
            self.assertEqual(rejected["sourceContextCheckboxes"], [])

    def test_manifest_drift_and_external_relationships_are_rejected(self):
        source = TOOLS / "derived-layout-fix/labor-layout-fixed.docx"
        with tempfile.TemporaryDirectory(prefix="task08-export-reject-") as tmp:
            tmp = Path(tmp)
            manifest = json.loads((TOOLS / "public-runtime-manifest.json").read_text())
            manifest["jdkHome"] = "/bin/sh"
            bad_manifest = tmp / "bad-manifest.json"
            bad_manifest.write_text(json.dumps(manifest))
            external = tmp / "external.docx"
            with ZipFile(source) as original, ZipFile(external, "w") as changed:
                for name in original.namelist():
                    data = original.read(name)
                    if name == "word/_rels/document.xml.rels":
                        relationships = ET.fromstring(data)
                        ET.SubElement(relationships, "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship", {"Id": "task08External", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", "Target": "https://task08-no-external.invalid/image.png", "TargetMode": "External"})
                        data = ET.tostring(relationships)
                    changed.writestr(name, data)
            for name, document, runtime, message in [("manifest", source, bad_manifest, "runtime manifest differs"), ("external", external, TOOLS / "public-runtime-manifest.json", "external relationships rejected"), ("implicit-lo", source, TOOLS / "public-runtime-manifest.json", "runtime manifest requires explicit docx4j")]:
                with self.subTest(rejection=name):
                    output = tmp / (name + ".pdf")
                    engine = [] if name == "implicit-lo" else ["--engine", "docx4j"]
                    result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "export-pdf", *engine, "--runtime-manifest", str(runtime), "--document", str(document), "--output", str(output)], capture_output=True, timeout=30)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(message, result.stderr.decode(errors="replace"))
                    self.assertFalse(output.exists())
                    self.assertFalse(output.with_suffix(".export.json").exists())

    def test_docx4j_export_has_real_boundary_and_preserves_verified_labor_layout(self):
        source = TOOLS / "derived-layout-fix/labor-layout-fixed.docx"
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        self.assertEqual(source_hash, "f56203e238ab82a2224c7c3a56bed8614cfc528bccd9a83b21a0ec6206c3580a")
        artifacts = Path(tempfile.mkdtemp(prefix="task08-public-export-", dir="/private/tmp"))
        output = artifacts / "labor.pdf"
        # An inherited Java option must not change the pinned invocation or load
        # arbitrary native agents before the SecurityManager starts.
        absent_agent = artifacts / "never-load.dylib"
        self.assertFalse(absent_agent.exists())
        invocation_env = {"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "JAVA_TOOL_OPTIONS": "-agentpath:" + str(absent_agent)}
        result = subprocess.run([sys.executable, str(HERE / "candidate.py"), "export-pdf", "--engine", "docx4j", "--runtime-manifest", str(TOOLS / "public-runtime-manifest.json"), "--document", str(source), "--output", str(output)], capture_output=True, timeout=150, env=invocation_env)
        (artifacts / "cli.stdout.log").write_bytes(result.stdout)
        (artifacts / "cli.stderr.log").write_bytes(result.stderr)
        print("ARTIFACTS=" + str(artifacts), flush=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        receipt = json.loads(output.with_suffix(".export.json").read_text())
        self.assertTrue(receipt["networkAndOutsideFileDenied"])
        self.assertEqual(receipt["conversionCalls"], 1)
        with pymupdf.open(output) as document:
            self.assertEqual(len(document), 15)
            text = "".join(re.sub(r"\s+", "", page.get_text()) for page in document)
            for literal in ["公司审批后方可生效，否则不予作为最终结算依据。", "所有工序、工艺，若乙方报价", "向甲方汇报，48小时"]:
                self.assertIn(literal, text)
            last = re.sub(r"\s+", "", document[-1].get_text())
            self.assertEqual(last.count("项目名称"), 1)
            for i in range(1, 4):self.assertIn(f"样张行{i:03d}", last)
            families = set()
            for page in document:
                self.assertAlmostEqual(page.rect.width, 595.28, delta=2)
                self.assertAlmostEqual(page.rect.height, 841.89, delta=2)
                for font in page.get_fonts(full=True):
                    name, _, _, data = document.extract_font(font[0])
                    self.assertGreater(len(data), 0)
                    families.add(name.split("+")[-1])
                for span in page.get_texttrace():
                    for char in span["chars"]:
                        if not chr(char[0]).isspace():self.assertNotEqual(char[1], 0)
            self.assertTrue({"SimHei", "FangSong_GB2312", "FZXBSJW--GB1-0"}.issubset(families))
            self.assertFalse(any("Heiti" in name for name in families))
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), source_hash)


if __name__ == "__main__":
    unittest.main()
