"""Seal the portable installer assembly to the exact isolated adopter bytes."""
from pathlib import Path
import gzip
import hashlib
import json
import shutil
import subprocess
import sys

plan, context, successor = map(Path, sys.argv[1:])
pins = json.loads((plan / "pins.json").read_text())

def check(file, wanted):
    if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != wanted:
        raise SystemExit("EXACT_292_STAGE_BYTES")

for file, expected in pins["material"].items():
    source = successor if file == "successor.cjs" else plan / file
    check(source, expected)
    target = "install-only.cjs" if file == "install-only292.cjs" else file
    shutil.copyfile(source, context / target)
for file in ("installer.cjs", "checkout.cjs"):
    pin = pins[file]
    source = context / file
    delta = plan / (file + ".patch.gz")
    check(source, pin["baseSha256"])
    check(delta, pin["deltaSha256"])
    subprocess.run(["patch", "--silent", "-F", "0", str(source)], input=gzip.decompress(delta.read_bytes()), check=True)
    check(source, pin["resultSha256"])
for file in ("checkout.cjs", "installer.cjs", "install-only.cjs", "successor.cjs"):
    subprocess.run(["node", "--check", str(context / file)], check=True)
