from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

if len(sys.argv) not in (5, 6) or (len(sys.argv) == 6 and sys.argv[5] not in ('--historical-settlement-334', '--expense-witness-346')):
    raise SystemExit('PFQ_STAGING_MODE')
historical, archive, common, out = map(Path,sys.argv[1:5])
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
if sha(installer)!='5f6e2959275504ff409928e6cab08e9cffabacc8dd22e484399db3b3671056d0':
    raise SystemExit('PFQ_COMBINED_INSTALLER_PREIMAGE')
subprocess.run(['git','apply','--unidiff-zero','-p0',str((plan/'pfq-installer-295.patch').resolve())],cwd=out,check=True)
if sha(installer)!='c2dbd11c7861f6c7cfac5dd47362a19b879e95f94ebe60197a0663696b029691':
    raise SystemExit('PFQ_COMBINED_INSTALLER_POSTIMAGE')
patch(entry,plan/'pfq-entry-modes.patch')
if len(sys.argv) == 6:
    if sha(entry) != '424ab1d10b2803ad70ac2fdcc201af97ae6e91ad060f70e2197ca988b52ba628':
        raise SystemExit('PFQ_334_ENTRY_PREIMAGE')
    subprocess.run(['git','apply','--unidiff-zero',str((plan/'pfq-installer-334.patch').resolve())],cwd=out,check=True)
    patch(entry,plan/'pfq-entry-334.patch')
    if sha(installer) != 'f58e1b29b35bbfb869676f83e9f24b1b6081e8050b6c787c4e5aa9432aa61430':
        raise SystemExit('PFQ_334_INSTALLER_POSTIMAGE')
    if sha(entry) != '5b34c78754a353d92dd23dea6680e7b548193fa1054e9b8e95b15487f1bcf1ce':
        raise SystemExit('PFQ_334_ENTRY_POSTIMAGE')
if sys.argv[5:] == ['--expense-witness-346']:
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent','-p1','-i',str((plan/'pfq-346.patch').resolve())],
                   cwd=out,check=True)
    if sha(installer) != '7c295260e5db55cef1552f13ee3eacc8f385bdedc12f1b1d20ccfaabd461ded4':
        raise SystemExit('PFQ_346_INSTALLER_POSTIMAGE')
    if sha(entry) != '2f851fbabd0d61c95df4833f81944ee80b29a4e1b343ff13c2fb1becd279081e':
        raise SystemExit('PFQ_346_ENTRY_POSTIMAGE')
for file in out.iterdir():
    file.chmod(0o644)
