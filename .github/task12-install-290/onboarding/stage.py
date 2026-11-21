"""Rebuild the offline-qualified workspace and original lane mounts, without starting a database."""
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile

plan, context, overlays, successor = map(Path, sys.argv[1:])
pins = json.loads((plan / "pins.json").read_text())

def need(condition, code):
    if not condition:
        raise SystemExit(code)

def check(file, digest):
    need(not file.is_symlink() and hashlib.sha256(file.read_bytes()).hexdigest() == digest, "ONBOARDING_290_HOSTED_INPUT_BYTES")

for file, expected in pins["resources"].items():
    check(plan / file, expected)
check(successor, pins["successorSha256"])
for name, expected in pins["patches"].items():
    base = context / name
    delta = plan / (name + ".patch.gz")
    check(base, expected["baseSha256"])
    check(delta, expected["patchSha256"])
    subprocess.run(["patch", "--silent", "-F", "0", str(base)], input=gzip.decompress(delta.read_bytes()), check=True)
    check(base, expected["resultSha256"])
for file in ("preflight.cjs", "verify-application-source.cjs", "lanes.json", "scope.json"):
    shutil.copyfile(plan / file, context / file)
shutil.copyfile(successor, context / "successor.cjs")
manifest = context / "workspace-inputs.json"
manifest.write_bytes(gzip.decompress((plan / "workspace-inputs.json.gz").read_bytes()))
check(manifest, pins["workspaceInputSha256"])
target = context / "workspace"
files = {}
for file in target.rglob("*"):
    need(not file.is_symlink(),"ONBOARDING_290_WORKSPACE_LINK")
    if file.is_file():
        files[file.relative_to(target).as_posix()]=hashlib.sha256(file.read_bytes()).hexdigest()
scope=json.loads((context/"scope.json").read_bytes())
need(json.loads(manifest.read_bytes())=={"tree":scope["tree"],"files":files},"ONBOARDING_290_WORKSPACE_BYTES")

expected_files = pins["overlayMembers"]
seen = set()
with tarfile.open(plan / "lanes.tar.gz", mode="r:gz") as archive:
    for member in archive:
        name = member.name
        parts = PurePosixPath(name).parts
        need(member.isfile() and name in expected_files and name not in seen and len(parts)>2
          and parts[0]=="lanes" and parts[1] in pins["lanes"] and ".." not in parts,"ONBOARDING_290_HOSTED_OVERLAY_SCOPE")
        target = overlays / name
        need(not target.exists(), "ONBOARDING_290_HOSTED_OVERLAY_SCOPE")
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.extractfile(member) as stream:
            data = stream.read()
        need(hashlib.sha256(data).hexdigest() == expected_files[name],"ONBOARDING_290_HOSTED_OVERLAY_BYTES")
        target.write_bytes(data)
        seen.add(name)
need(seen == set(expected_files),"ONBOARDING_290_HOSTED_OVERLAY_SCOPE")
print(json.dumps({"status":"ONBOARDING_290_SEALED_WORKSPACE_ASSEMBLED","sourceFiles":len(files),
  "lanes":len(pins["lanes"]),"overlaySlots":len(seen)}))
