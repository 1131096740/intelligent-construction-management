from hashlib import sha256
from pathlib import Path
import gzip
import os
import json
import subprocess
import sys
import tempfile
import shutil

os.umask(0o022)
repo, prepared, out = map(Path, sys.argv[1:])
plan = donor = Path(__file__).resolve().parent
native = repo / '.github/task12-install-289'
common = repo / '.github/task12-install-295/contract-finance/common'
historical = prepared / 'prepared/context'
source = json.loads((prepared / 'source.json').read_bytes())
ref = source['sourceSha']
count = source['migrationCount']
current320 = source.get('mode') == 'current-320'
mode = ['--current-320'] if current320 else []
previous = source['predecessor'] if current320 else source
assert previous['migrationCount'] == 295 and len(previous['tails']) == 3
if current320:
    assert count == 322 and len(source['tails']) == 27
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip() == ref
admission = subprocess.check_output(['node',str(common.parent/'check-ledger.cjs'),str(repo),ref,*mode])
assert json.loads(admission) == source
proof = json.loads((common/'tree-proof.json').read_bytes())


def digest(data):
    return sha256(data).hexdigest()


def read_pinned(path, expected):
    data = path.read_bytes()
    assert not path.is_symlink() and digest(data) == expected, str(path)
    return data


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(0o644)


def patch(material, delta):
    with tempfile.TemporaryDirectory(dir=out) as scratch:
        target = Path(scratch) / 'source'
        write(target, material)
        subprocess.run(['patch','--batch','--fuzz=0','--silent',str(target)],input=delta,check=True)
        return target.read_bytes()


def overlay(material, pin):
    assert digest(material) == pin['base']
    result = patch(material, gzip.decompress((donor/pin['file']).read_bytes()))
    assert digest(result) == pin['result']
    return result


out.mkdir()
context = out/'context'
context.mkdir()
workspace = context/'workspace'
workspace.mkdir()
shutil.copytree(historical/'source',context/'source')
write(context/'checkout.cjs',read_pinned(native/'checkout.cjs','77eaa09f4dd25bb0c1b2a6da987d7b1b976188295f1be3a5d2d83f2c44990268'))
for name in ['source-admission.json','source-seal.txt','exact-source.json']:
    write(context/name,(historical/name).read_bytes())
pins = json.loads(read_pinned(donor/'pins.json','df1b3f765cb12a452e21d8e6ab1ba4a0495702c282607877d67ff102416bf69e'))
old_installer = overlay((native/'installer.cjs').read_bytes(),pins['installer'])
new_installer = patch(old_installer,(plan/'installer-named295.patch').read_bytes())
assert digest(new_installer) == 'e94bd046c552817cbd49cfb86c693ea0e0496d93f677f99801f90dfad835a7ef'
if current320:
    new_installer = patch(new_installer,(plan/'installer-named320.patch').read_bytes())
write(context/'installer.cjs',new_installer)
for name, pin in pins['runtime'].items():
    material = read_pinned(repo/pin['repoFile'] if 'repoFile' in pin else donor/pin['file'],pin['digest'])
    if name == 'install-only.cjs':
        material = patch(material,(plan/'entry-named295.patch').read_bytes())
        assert digest(material) == '25ecadbca109001a672b9879d34bebedbdc14a964506ab5eed539b6ff4d5f47d'
        if current320:
            replacements = {
                b'const {withNamedPol113Pol114295}': b'const {withNamedPol113Pol114320}',
                b"NAMED_POL113_POL114_EXACT_295',mode": b"NAMED_POL113_POL114_EXACT_320',mode",
                b'await withNamedPol113Pol114295(receipt': b'await withNamedPol113Pol114320(receipt',
                b"receipt.orderedTails.slice(-6).map(({size})=>size),[290,291,292,293,294,295]":
                    b"receipt.orderedTails.slice(-7).map(({size})=>size),[290,291,292,293,294,295,322]",
                b"  receipt.status='POL113_POL114_NAMED_EXACT_295_PASSED';": b'''  assert.equal(receipt.forward320?.sourceTree,admission.sourceTree);
  assert.equal(receipt.forward320?.ledgerSha256,admission.ledger320);
  assert.deepEqual(receipt.postBehavior320,{exactB7:true,sameIdentity:true,count:322,ledgerSha256:admission.ledger320});
  receipt.status='POL113_POL114_NAMED_EXACT_322_PASSED';''',
            }
            for old, new in replacements.items():
                assert material.count(old) == 1
                material = material.replace(old, new)
            diagnostic_anchor = b'        ...bootSummary(traces),\n'
            diagnostic = br"""        statuses:traces.flatMap(value=>{
          if(typeof value!=="string")return [];
          const match=/Expected:\s*([1-5][0-9]{2})[\s\S]{0,125}Received:\s*([1-5][0-9]{2})/u.exec(value);
          return match?[{expected:Number(match[1]),actual:Number(match[2])}]:[];
        }).slice(0,3),
        sqlstates:[...new Set(traces.flatMap(value=>typeof value==="string"
          ? [...value.matchAll(/(?:SQLSTATE\s+|Raw query failed\. Code:\s*`|SqlState\(E)([A-Z0-9]{5})\b/gu)].map(match=>match[1])
          : []))].slice(0,4),
        frames:traces.flatMap(value=>typeof value==="string"
          ? [...value.matchAll(/\b(?:base-entry-http-postgres|project-business-scope-http-postgres|contract-business-entry-http)\.spec\.ts:(\d+):(\d+)/gu)]
              .slice(0,3).map(frame=>[Number(frame[1]),Number(frame[2])])
          : []).slice(0,3),
"""
            assert material.count(diagnostic_anchor) == 1
            material = material.replace(diagnostic_anchor, diagnostic_anchor + diagnostic)
    write(context/name,material)
for name, pin in pins['named'].items():
    material = overlay((historical/'source/services/api/prisma'/name).read_bytes(),pin) if 'base' in pin else read_pinned(donor/pin['file'],pin['result'])
    write(context/'named-authority-modules'/name,material)
for name in ['scope.json','successor.cjs','successor.sql','tree-proof.json']:
    write(context/'named292'/name,(historical/name).read_bytes())
for name in ['terminal.cjs','terminal.json','payout-terminal.cjs','multi-witness.cjs']:
    write(context/name,(common/name).read_bytes())
write(context/'named295-tail.cjs',(plan/'named295-tail.cjs').read_bytes())
for candidate, alias in zip(previous['tails'],('terminal.sql','payout-terminal.sql','multi-witness.sql')):
    write(context/alias,read_pinned(prepared/'tails'/candidate['name']/'migration.sql',candidate['sha256']))
subprocess.run(['node','-e',"""
const {join}=require('node:path');
const root=process.argv[1];
require(join(root,'terminal.cjs')).verify(join(root,'terminal.sql'));
require(join(root,'payout-terminal.cjs')).verify(join(root,'payout-terminal.sql'));
require(join(root,'multi-witness.cjs')).verify(join(root,'multi-witness.sql'));
""",str(context.resolve())],check=True)

# Stream the exact current Git archive once. Preserve original fixture patches on their matching preimages.
with subprocess.Popen(['git','-C',str(repo),'archive',ref,'--','package.json','pnpm-lock.yaml','pnpm-workspace.yaml',
                       'scripts','packages/shared-domain','apps/web-admin','services/api'],stdout=subprocess.PIPE) as archive:
    subprocess.run(['tar','xf','-','-C',str(workspace)],stdin=archive.stdout,check=True)
    archive.stdout.close()
    assert archive.wait() == 0

for name,pin in pins['workspace'].items():
    path = workspace/name
    material = path.read_bytes()
    if name.endswith('/database-dynamic-gate-manifest.json'):
        # The original named fixture qualifies a 289-era business profile. Its original
        # overlay replaced only these three scalars, independently of installation ledger.
        before = json.loads(material)
        keys = ('expectedDirectoryCount','terminalMigration','terminalMigrationChecksum')
        last = source['tails'][-1]
        assert tuple(before['migrationBaseline'][key] for key in keys) == (count,last['name'],last['sha256'])
        historical_base = subprocess.check_output(['git','-C',str(repo),'show',
            f'233e0d6808352e4b169ec0a82909afc0d3b8f8fa:{name}'])
        original = json.loads(overlay(historical_base,pin))
        for key in keys:
            before['migrationBaseline'][key] = original['migrationBaseline'][key]
        write(path,(json.dumps(before,ensure_ascii=False,indent=2)+'\n').encode())
    else:
        write(path,overlay(material,pin))

files=sorted(p for p in workspace.rglob('*') if p.is_file())
assert not any(p.is_symlink() for p in workspace.rglob('*'))
write(context/'workspace.sha256',''.join(f'{digest(p.read_bytes())}  ./{p.relative_to(workspace).as_posix()}\n' for p in files).encode())
write(context/'candidate-admission.json',(json.dumps({
    'tree':proof['tree'],'candidateSha':ref,'ledger292':proof['combined292'],'ledger295':previous['ledgerSha256'],
    'migrationCount':count,
    **({'sourceTree':source['sourceTree'],'ledger320':source['ledgerSha256'],'tails':source['tails']} if current320 else {}),
})+'\n').encode())
docker = read_pinned(donor/'Dockerfile.in','7a99ba7b82ad0ede0ca3aaedb16783a49b6a4b3f393754bdb336cd730f4c2aae').decode()
copy = read_pinned(donor/'runtime-copy.txt','de9a7b69c406aa307423a7231ec086b8c6995bd435bfc1fae0bb0dab5d4b40e6').decode().strip()
docker = docker.replace('@RUNTIME_COPY@',copy+'\nCOPY --chmod=0644 named295-tail.cjs terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs terminal.sql payout-terminal.sql multi-witness.sql /qualification/')
write(context/'Dockerfile',docker.encode())
for file in context.glob('*.cjs'):
    subprocess.run(['node','--check',str(file)],check=True)
assert not any(p.is_symlink() for p in context.rglob('*'))
write(out/'context.sha256',''.join(f'{digest(p.read_bytes())}  ./{p.relative_to(context).as_posix()}\n'
    for p in sorted(context.rglob('*')) if p.is_file()).encode())
print(json.dumps({'status':f'NAMED_{count}_PORTABLE_MATERIAL_READY','sourceSha':ref,'workspaceFiles':len(files),'workspaceOverlays':len(pins['workspace'])}))
