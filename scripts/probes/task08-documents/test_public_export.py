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
