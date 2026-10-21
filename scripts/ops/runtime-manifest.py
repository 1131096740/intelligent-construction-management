#!/usr/bin/env python3
"""Capture code-only runtime trees and persist differences before failing closed."""
import argparse
import hashlib
import json
import os
import stat
import sys
from pathlib import Path


class CaptureError(RuntimeError):
    def __init__(self, path, kind):
        super().__init__("runtime entry capture failed")
        self.path = path
        self.kind = kind


def write_new(path, value):
    path = Path(path)
    with path.open("x", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def capture(root):
    root = Path(root).absolute()
    entries = {}

    def inspect_entry(path):
        before = path.lstat()
        item = {"mode": stat.S_IMODE(before.st_mode), "uid": before.st_uid,
                "gid": before.st_gid}
        if stat.S_ISLNK(before.st_mode):
            item.update(kind="link", target=os.readlink(path))
        elif stat.S_ISDIR(before.st_mode):
            item.update(kind="dir")
            children = sorted(path.iterdir())
            for child in children:
                visit(child)
            if children != sorted(path.iterdir()):
                raise RuntimeError("directory changed during capture")
        elif stat.S_ISREG(before.st_mode):
            digest = hashlib.sha256()
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                opened = os.fstat(stream.fileno())
                if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                    raise RuntimeError("file replaced during capture")
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            item.update(kind="file", bytes=before.st_size, sha256=digest.hexdigest())
        else:
            raise RuntimeError("special filesystem entry is not a runtime artifact")
        after = path.lstat()
        stable = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size",
                  "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, key) != getattr(after, key) for key in stable):
            raise RuntimeError("entry changed during capture")
        entries[str(path.relative_to(root))] = item

    def visit(path):
        try:
            inspect_entry(path)
        except CaptureError:
            raise
        except Exception as error:
            raise CaptureError(str(path.relative_to(root)), type(error).__name__) from error

    visit(root)
    if entries["."]["kind"] != "dir":
        raise CaptureError(".", "RuntimeError")
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
    return {"schemaVersion": 1, "status": "captured", "root": str(root),
            "entries": entries, "entriesSha256": hashlib.sha256(encoded).hexdigest()}


def differences(expected, actual):
    result = []
    for path in sorted(expected.keys() | actual.keys()):
        left, right = expected.get(path), actual.get(path)
        if left != right:
            reason = "unexpected" if left is None else "missing" if right is None else "changed"
            result.append({"path": path, "reason": reason, "expected": left, "actual": right})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    save = sub.add_parser("capture")
    save.add_argument("--root", required=True)
    save.add_argument("--manifest", required=True)
    compare = sub.add_parser("compare")
    compare.add_argument("--expected", required=True)
    compare.add_argument("--root", required=True)
    compare.add_argument("--actual-manifest", required=True)
    compare.add_argument("--receipt", required=True)
    args = parser.parse_args()
    receipt = {"schemaVersion": 1, "status": "failed", "root": args.root}
    try:
        if args.operation == "capture":
            write_new(args.manifest, capture(args.root))
            return 0
        expected = json.loads(Path(args.expected).read_text())
        if expected.get("schemaVersion") != 1 or expected.get("status") != "captured":
            raise ValueError("expected manifest is not a completed capture")
        encoded = json.dumps(expected["entries"], sort_keys=True, separators=(",", ":")).encode()
        if hashlib.sha256(encoded).hexdigest() != expected["entriesSha256"]:
            raise ValueError("expected manifest digest mismatch")
        actual = capture(args.root)
        write_new(args.actual_manifest, actual)
        changes = differences(expected["entries"], actual["entries"])
        receipt.update(status="failed" if changes else "passed", differences=changes,
                       expectedManifest=args.expected, actualManifest=args.actual_manifest,
                       expectedEntriesSha256=expected["entriesSha256"],
                       actualEntriesSha256=actual["entriesSha256"])
    except Exception as error:
        # No raw exception text: paths are useful evidence, file contents are never printed.
        receipt.update(errorClass=type(error).__name__, error="runtime manifest operation failed")
        if isinstance(error, CaptureError):
            receipt.update(errorClass=error.kind, errorPath=error.path)
            if args.operation == "compare":
                write_new(args.actual_manifest, {
                    "schemaVersion": 1, "status": "failed", "root": args.root,
                    "errorClass": error.kind, "errorPath": error.path,
                    "completeEntriesAvailable": False})
        if args.operation == "capture":
            write_new(args.manifest, receipt)
            return 1
    write_new(args.receipt, receipt)
    print(json.dumps({"status": receipt["status"], "receipt": args.receipt,
                      "differences": len(receipt.get("differences", []))}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
