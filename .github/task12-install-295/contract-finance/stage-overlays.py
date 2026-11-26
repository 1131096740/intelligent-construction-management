from pathlib import Path
from hashlib import sha256
import gzip
import json
import os
import subprocess
import sys

plan = Path(__file__).resolve().parent
workspace, destination = map(Path, sys.argv[1:3])
lane = sys.argv[3]
assert lane in ('bank', 'restore')
mode = sys.argv[4:]
bank_profiles = {
    '--current-320': ('staging-320.json',),
    '--text-direct-330': ('staging-330.json',),
    '--payment-remainder-331': ('staging-330.json', 'staging-331.json'),
    '--historical-settlement-334': ('staging-330.json', 'staging-331.json', 'staging-332.json', 'staging-334.json'),
    '--upward-archive-332': ('staging-330.json', 'staging-331.json', 'staging-332.json'),
}
assert mode == [] or (lane == 'bank' and len(mode) == 1 and mode[0] in bank_profiles)
os.umask(0o022)
rows = json.loads((plan / 'staging-manifest.json').read_bytes())
for manifest in bank_profiles[mode[0]] if mode else ():
    current = json.loads((plan / 'bank' / manifest).read_bytes())
    assert all(name.startswith('bank/') and name in rows for name in current)
    rows.update(current)
destination.mkdir()
for name, row in sorted(rows.items(), key=lambda item: item[1]['kind'].endswith('-manifest')):
    if not name.startswith(lane + '/'):
        continue
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    kind = row['kind']
    if kind in ('copy', 'patch'):
        original = workspace / row['source']
        source = original.read_bytes()
        if sha256(source).hexdigest() != row['sourceSha256']:
            raise RuntimeError(f'CONTRACT_FINANCE_OVERLAY_PREIMAGE {name}')
    if kind != 'copy':
        material = gzip.decompress((plan / 'materials' / row['material']).read_bytes())
        if sha256(material).hexdigest() + '.gz' != row['material']:
            raise RuntimeError(f'CONTRACT_FINANCE_OVERLAY_MATERIAL {name}')
    if kind == 'patch':
        target.write_bytes(source)
        subprocess.run(
            ['patch', '--batch', '--fuzz=0', '--no-backup-if-mismatch', str(target)],
            input=material, check=True, stdout=subprocess.DEVNULL,
        )
    elif kind in ('copy', 'full'):
        target.write_bytes(source if kind == 'copy' else material)
    elif kind in ('execution-manifest', 'correction-manifest'):
        def digest(relative, overlay):
            item = overlay / relative
            return sha256((item if item.is_file() else workspace / relative).read_bytes()).hexdigest()
        result = json.loads(material)
        if kind == 'execution-manifest':
            overlay = destination / ('bank/overlay' if lane == 'bank' else 'restore/loan')
            result = [[relative, digest(relative, overlay)] for relative in result]
        else:
            for field, overlay in (('actual', destination / 'restore/correction'), ('exact', workspace)):
                result[field] = {
                    relative: digest('services/api/src/' + relative, overlay) for relative in result[field]
                }
        target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    else:
        raise RuntimeError(f'CONTRACT_FINANCE_OVERLAY_KIND {name}')
    if sha256(target.read_bytes()).hexdigest() != row['sha256']:
        raise RuntimeError(f'CONTRACT_FINANCE_OVERLAY_POSTIMAGE {name}')
