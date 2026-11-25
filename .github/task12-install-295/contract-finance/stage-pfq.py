from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

historical, archive, common, out = map(Path,sys.argv[1:])
plan=Path(__file__).parent
pins=json.loads((archive/'profile.json').read_text())['pfqAssembly']
old=historical/'pfq'
out.mkdir()
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
def patch(target, delta):
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(target),str(delta)],check=True)

for name in ('entry.cjs','installer.cjs','task12-pfq-positive-fixtures.json','task12-pfq-recovery.cjs',
             'task12-pfq-recovery.json','task12-pfq-app.cjs','task12-pfq-jest-wire.cjs',
             'project-financing-quota-concurrency.owned282.spec.ts'):
    shutil.copyfile(old/name,out/name)
    if name in pins:
        pin=pins[name]
        delta=archive/('pfq-'+Path(name).stem+'.patch')
        if sha(out/name)!=pin['baseSha256'] or sha(delta)!=pin['patchSha256']:
            raise SystemExit('PFQ_290_ARCHIVE_PREIMAGE')
        patch(out/name,delta)
        if sha(out/name)!=pin['resultSha256']:
            raise SystemExit('PFQ_290_ARCHIVE_POSTIMAGE')
entry=out/'entry.cjs'
text=entry.read_text()
entry.write_text(text.replace('withOutside289Pfq','withPfq295')
    .replace('ORIGINAL_PFQ_EXACT_290','ORIGINAL_PFQ_EXACT_295')
    .replace('installOnly290?.count,290','installOnly295?.count,295')
    .replace('a1be083076018686dd8afba68c44ff9c75502014','67644d9465a0ab4ee80ede099139d9c129d66f14')
    .replace('{count:290,exactB7:true}','{count:295,exactB7:true}')
    .replace('at(-1).size,289','at(-1).size,295')
    .replace('schemaVersion:1,purpose','schemaVersion:1,sourceSha:require(\'./contract-finance-source.json\').sourceSha,purpose')
    .replace('  assert.equal(receipt.business,','  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);\n  assert.equal(receipt.business,'))
installer=out/'installer.cjs'
shutil.copyfile(common/'installer.cjs',installer)
if sha(installer)!='a0e1583bac5131303b88f2210ed9d8cd924e1ae98fdfb34d3441ce9de4cb864a':
    raise SystemExit('PFQ_COMBINED_INSTALLER_PREIMAGE')
subprocess.run(['git','apply','--unidiff-zero','-p0',str((plan/'pfq-installer-295.patch').resolve())],cwd=out,check=True)
if sha(installer)!='4f9508c071ff63429ba07fddf83e13eb375fdcb76f5aafae6da08ebe64aab8bb':
    raise SystemExit('PFQ_COMBINED_INSTALLER_POSTIMAGE')
patch(entry,plan/'pfq-entry-modes.patch')
for file in out.iterdir():
    file.chmod(0o644)
