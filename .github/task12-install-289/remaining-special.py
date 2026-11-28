"""Stage a fixed retained-history consumer and verify the original installer postimage."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys


def check_file(file, expected):
    if file.is_symlink() or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
        raise SystemExit("REMAINING_SPECIAL_289_BYTES")


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("cleanup", "profile", "wage"):
        raise SystemExit("REMAINING_SPECIAL_289_MODE")
    lane, installer = sys.argv[1], Path(sys.argv[2])
    here = Path(__file__).resolve().parent
    material = json.loads((here / "remaining-special.json").read_bytes())[lane]
    folder = here / "remaining-special" / lane
    delta = folder / "installer.patch"
    check_file(installer, material["baseSha256"])
    check_file(delta, material["patchSha256"])
    mounts = []
    for file, pin in material["mounts"].items():
        source = folder / file
        check_file(source, pin["sha256"])
        mounts.append((source, pin["target"]))
    subprocess.run(["patch", "--silent", "-F", "0", str(installer), str(delta)], check=True, stdout=sys.stderr)
    check_file(installer, material["installerSha256"])
    for source, target in mounts:
        print(f"{source}\t{target}")


if __name__ == "__main__":
    main()
