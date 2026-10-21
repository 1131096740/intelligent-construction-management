import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

TOOL = Path(__file__).with_name("runtime-manifest.py")


class RuntimeManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.built = self.root / "built"
        self.runtime = self.root / "runtime"
        self.built.mkdir()
        (self.built / "main.js").write_text("new")
        # The gate runs with umask 077; this fixture needs a deliberate mode
        # difference rather than relying on the caller's creation permissions.
        (self.built / "main.js").chmod(0o644)
        (self.built / ".hidden").write_text("hidden")
        (self.built / "empty").mkdir()
        (self.built / "node_modules").symlink_to("/private/not-followed")
        shutil.copytree(self.built, self.runtime, symlinks=True)

    def tearDown(self):
        self.temp.cleanup()

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(TOOL), *map(str, args)], capture_output=True, text=True)

    def compare(self):
        expected = self.root / "expected.json"
        result = self.run_tool("capture", "--root", self.built, "--manifest", expected)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = self.root / "result.json"
        result = self.run_tool("compare", "--expected", expected, "--root", self.runtime,
                               "--actual-manifest", self.root / "actual.json", "--receipt", receipt)
        return result, json.loads(receipt.read_text())

    def test_identical_copy_passes_without_following_external_links(self):
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(receipt["differences"], [])
        self.assertEqual((self.root / "result.json").stat().st_mode & 0o777, 0o600)

    def test_deployed_web_dist_layer_must_not_be_compared_to_parent(self):
        web = self.root / "web-admin"
        web.mkdir()
        shutil.copytree(self.built, web / "dist", symlinks=True)
        self.runtime = web
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(any(x["path"] == "dist/main.js" for x in receipt["differences"]))
        result = self.run_tool("compare", "--expected", self.root / "expected.json",
                               "--root", web / "dist", "--actual-manifest", self.root / "correct.actual.json",
                               "--receipt", self.root / "correct.diff.json")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_failure_evidence_does_not_disclose_file_content(self):
        sentinel = "PRIVATE_CONTENT_MUST_NEVER_BE_EXPORTED"
        (self.runtime / "main.js").write_text(sentinel)
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(sentinel, (self.root / "actual.json").read_text())
        self.assertNotIn(sentinel, json.dumps(receipt) + result.stdout + result.stderr)

    def test_same_size_same_timestamp_tamper_is_saved_before_failure(self):
        (self.runtime / "main.js").write_text("old")
        stamp = (self.built / "main.js").stat()
        os.utime(self.runtime / "main.js", ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        changed = next(x for x in receipt["differences"] if x["path"] == "main.js")
        self.assertNotEqual(changed["expected"]["sha256"], changed["actual"]["sha256"])
        self.assertEqual(changed["expected"]["bytes"], changed["actual"]["bytes"])
        self.assertTrue((self.root / "actual.json").is_file())

    def test_missing_extra_hidden_empty_directory_and_mode_all_fail(self):
        (self.runtime / ".hidden").unlink()
        (self.runtime / "empty").rmdir()
        (self.runtime / "extra").write_text("unexpected")
        (self.runtime / "main.js").chmod(0o600)
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        self.assertEqual({x["path"] for x in receipt["differences"]}, {".hidden", "empty", "extra", "main.js"})

    def test_link_target_change_fails_without_reading_target(self):
        (self.runtime / "node_modules").unlink()
        (self.runtime / "node_modules").symlink_to("/other/private-target")
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(receipt["differences"][0]["path"], "node_modules")

    def test_missing_root_also_persists_failure_receipt(self):
        shutil.rmtree(self.runtime)
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(receipt["errorClass"], "FileNotFoundError")
        actual = json.loads((self.root / "actual.json").read_text())
        self.assertEqual(actual["status"], "failed")
        self.assertFalse(actual["completeEntriesAvailable"])

    def test_metadata_owner_difference_is_not_ignored(self):
        spec = importlib.util.spec_from_file_location("manifest", TOOL)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        old = {"node_modules": {"kind": "link", "uid": 0, "gid": 0, "target": "/same"}}
        new = {"node_modules": {"kind": "link", "uid": 1000, "gid": 1001, "target": "/same"}}
        self.assertEqual(module.differences(old, new)[0]["path"], "node_modules")

    def test_manifest_tamper_is_refused_and_recorded(self):
        expected = self.root / "expected.json"
        self.assertEqual(self.run_tool("capture", "--root", self.built, "--manifest", expected).returncode, 0)
        value = json.loads(expected.read_text())
        value["entries"]["main.js"]["sha256"] = "0" * 64
        expected.write_text(json.dumps(value))
        result = self.run_tool("compare", "--expected", expected, "--root", self.runtime,
                               "--actual-manifest", self.root / "actual.json", "--receipt", self.root / "result.json")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads((self.root / "result.json").read_text())["errorClass"], "ValueError")

    def test_root_link_is_refused_without_following_it(self):
        root_link = self.root / "root-link"
        root_link.symlink_to(self.built, target_is_directory=True)
        result = self.run_tool("capture", "--root", root_link, "--manifest", self.root / "root-link.json")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads((self.root / "root-link.json").read_text())["errorClass"], "RuntimeError")

    def test_fifo_fails_closed_without_blocking(self):
        os.mkfifo(self.runtime / "pipe")
        result, receipt = self.compare()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(receipt["errorClass"], "RuntimeError")
        self.assertEqual(receipt["errorPath"], "pipe")


if __name__ == "__main__":
    unittest.main()
