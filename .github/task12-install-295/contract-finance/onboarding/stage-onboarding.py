from pathlib import Path, PurePosixPath
import gzip
import hashlib
import json
import subprocess
import sys
import tarfile

archive, common, workspace, out, source = map(Path,sys.argv[1:])
plan=Path(__file__).parent
pins=json.loads((archive/'pins.json').read_text())
for name, expected in pins['resources'].items():
    if hashlib.sha256((archive/name).read_bytes()).hexdigest()!=expected:
        raise SystemExit('ONBOARDING_295_ARCHIVE_PIN '+name)
source_record=json.loads(source.read_text())
count=source_record['migrationCount']
current320=source_record.get('mode')=='current-320'
if count!=(323 if current320 else 295):
    raise SystemExit('ONBOARDING_SOURCE_LEDGER')
application_tree=source_record['sourceTree'] if current320 else '67644d9465a0ab4ee80ede099139d9c129d66f14'
if current320:
    import re
    if not re.fullmatch('[0-9a-f]{40}',application_tree):
        raise SystemExit('ONBOARDING_320_SOURCE_TREE')
old=json.loads(gzip.decompress((archive/'workspace-inputs.json.gz').read_bytes()))
expected_drift=json.loads((plan/f'onboarding-{count}-source-drift.json').read_text())
actual={}
changes={}
for name, previous in old['files'].items():
    file=workspace/name
    digest=hashlib.sha256(file.read_bytes()).hexdigest()
    actual[name]=digest
    if digest!=previous:
        changes[name]=digest
if changes!=expected_drift:
    raise SystemExit('ONBOARDING_295_SOURCE_INPUT_DELTA '+str(sorted(changes.keys()^expected_drift.keys() | {k for k in changes.keys()&expected_drift.keys() if changes[k]!=expected_drift[k]})))
with tarfile.open(archive/'lanes.tar.gz') as sealed:
    for row in sealed:
        rel=PurePosixPath(row.name)
        if not row.isfile() or rel.is_absolute() or '..' in rel.parts or rel.parts[0]!='lanes':
            raise SystemExit('ONBOARDING_295_ARCHIVE_PATH')
        file=out/row.name
        file.parent.mkdir(parents=True,exist_ok=True)
        with file.open('xb') as target:
            target.write(sealed.extractfile(row).read())
        file.chmod(0o644)
profiles=json.loads((archive/'lanes.json').read_text())
for lane in pins['lanes']:
    for name,sha in profiles[lane]['fixturePins'].items():
        file=out/'lanes'/lane/'fixtures'/name
        if hashlib.sha256(file.read_bytes()).hexdigest()!=sha:
            raise SystemExit('ONBOARDING_295_FIXTURE_PIN '+name)
    lane_root=out/'lanes'/lane
    entry=lane_root/'entry.cjs'
    text=entry.read_text().replace('290','295').replace('?.size!==289','?.size!==295')
    if current320:
        if text.count('_295_PASSED')!=1:
            raise SystemExit('ONBOARDING_320_STATUS_ANCHOR')
        text=text.replace('_295_PASSED','_323_PASSED')
    entry.write_text(text)
    runner=lane_root/'onboarding-full.cjs'
    text=runner.read_text()
    if text.count('a1be083076018686dd8afba68c44ff9c75502014')!=1:
        raise SystemExit('ONBOARDING_295_RUNTIME_ANCHOR')
    runner.write_text(text.replace('a1be083076018686dd8afba68c44ff9c75502014',application_tree))
    if lane=='roster':
        seed=lane_root/'onboarding-roster-seed.cjs'
        material=seed.read_bytes()
        if hashlib.sha256(material).hexdigest()!='9646d99e10a4aa3fde4bf7d9c5f4e9bd6a24cae83b5ae2bbeaa3a02e51b01b91' or material.count(b'a1be083076018686dd8afba68c44ff9c75502014')!=1:
            raise SystemExit('ONBOARDING_295_ROSTER_SEED_PREIMAGE')
        seed.write_bytes(material.replace(b'a1be083076018686dd8afba68c44ff9c75502014',application_tree.encode()))
        subprocess.run(['node','--check',str(seed)],check=True)
    for file in [entry,runner]:
        subprocess.run(['node','--check',str(file)],check=True)
(out/'workspace-inputs.json').write_text(json.dumps({'tree':application_tree,
    'sourceSha':source_record['sourceSha'],'files':actual},ensure_ascii=False)+'\n')
verifier=(archive/'verify-application-source.cjs').read_text()
(out/'verify-application-source.cjs').write_text(verifier.replace(old['tree'],application_tree)
    .replace('return {tree:manifest.tree,',"assert.equal(manifest.sourceSha,require('./contract-finance-source.json').sourceSha);\n  return {sourceSha:manifest.sourceSha,tree:manifest.tree,"))
(out/'lanes.json').write_bytes((archive/'lanes.json').read_bytes())
installer=out/'installer.cjs'
installer.write_bytes((common/'installer.cjs').read_bytes())
subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(installer),str(plan/'installer-onboarding.patch')],check=True)
subprocess.run(['node','--check',str(installer)],check=True)
for file in [out/'workspace-inputs.json',out/'verify-application-source.cjs',out/'lanes.json',installer]:
    file.chmod(0o644)
