"""Compose the sealed completion lane after assembling a fresh partial workspace."""
import hashlib
import json
from pathlib import Path
import sys

plan = Path(__file__).resolve().parent
context = Path(sys.argv[1]).resolve()
workspace = context / 'workspace'
pins = json.loads((plan / 'pins.json').read_text())

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def require(ok, reason):
    if not ok:
        sys.exit(reason)

def inventory():
    paths = sorted(workspace.rglob('*'))
    require(not any(file.is_symlink() for file in paths), 'TASK398_COMPLETION_WORKSPACE_SYMLINK')
    return {p.relative_to(workspace).as_posix(): sha(p) for p in paths if p.is_file()}

manifest = context / 'workspace-inputs.json'
require(sha(manifest) == pins['priorInventory'], 'TASK398_COMPLETION_PARTIAL_MANIFEST')
before = inventory()
require(before == json.loads(manifest.read_bytes()), 'TASK398_COMPLETION_PARTIAL_PREIMAGE')
for root, group in [(workspace, 'workspace'), (context, 'harness')]:
    for name, row in pins[group].items():
        target = root / name
        source = plan / 'fixtures' / row['file']
        require(not target.is_symlink() and (sha(target) if target.is_file() else None) == row['base'],
                f'TASK398_COMPLETION_OVERLAY_PREIMAGE {name}')
        require(not source.is_symlink() and sha(source) == row['result'],
                f'TASK398_COMPLETION_OVERLAY_POSTIMAGE {name}')
        target.write_bytes(source.read_bytes())

after = inventory()
require(set(pins['workspace']) == {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)},
        'TASK398_COMPLETION_OVERLAY_SCOPE')
closure = hashlib.sha256(json.dumps(after, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
require(len(after) == pins['count'] and closure == pins['closure'], 'TASK398_COMPLETION_RUNTIME_CLOSURE')
manifest.write_text(json.dumps(after, indent=2) + '\n')
print(json.dumps({'group':'task398_browser_completion','workspaceFiles':len(after),'overlays':len(pins['workspace'])}))
