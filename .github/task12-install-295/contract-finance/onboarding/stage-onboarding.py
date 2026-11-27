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
mode=source_record.get('mode')
text_direct=mode=='text-direct-330'
signed_settlement=mode=='signed-settlement-350'
precision=signed_settlement or mode=='expense-witness-349'
expense_witness=precision or mode=='expense-witness-346'
historical_settlement=mode=='historical-settlement-334' or expense_witness
upward_archive=mode=='upward-archive-332' or historical_settlement
payment_remainder=mode=='payment-remainder-331' or upward_archive
forward=mode=='current-320' or text_direct or payment_remainder
if count!={'signed-settlement-350':350,'expense-witness-349':349,'expense-witness-346':346,'historical-settlement-334':334,'upward-archive-332':332,'payment-remainder-331':331,'text-direct-330':330,'current-320':329}.get(mode,295):
    raise SystemExit('ONBOARDING_SOURCE_LEDGER')
application_tree=source_record['sourceTree'] if forward else '67644d9465a0ab4ee80ede099139d9c129d66f14'
if forward:
    import re
    if not re.fullmatch('[0-9a-f]{40}',application_tree):
        raise SystemExit('ONBOARDING_320_SOURCE_TREE')
old=json.loads(gzip.decompress((archive/'workspace-inputs.json.gz').read_bytes()))
expected_drift=json.loads((plan/f'onboarding-{329 if forward else 295}-source-drift.json').read_text())
if text_direct or payment_remainder:
    expected_drift.update(json.loads((plan/'onboarding-330-source-drift.json').read_text()))
additional={}
if payment_remainder:
    candidate_drift=json.loads((plan/'onboarding-331-source-drift.json').read_text())
    if upward_archive:
        candidate_drift.update(json.loads((plan/'onboarding-332-source-drift.json').read_text()))
    if historical_settlement:
        candidate_drift.update(json.loads((plan/'onboarding-334-source-drift.json').read_text()))
    if expense_witness:
        candidate_drift.update(json.loads((plan/'onboarding-346-source-drift.json').read_text()))
    if precision:
        candidate_drift.update(json.loads((plan/'onboarding-349-source-drift.json').read_text()))
    if signed_settlement:
        candidate_drift.update(json.loads((plan/'onboarding-350-source-drift.json').read_text()))
    expected_drift.update({name:digest for name,digest in candidate_drift.items() if name in old['files']})
    # Also pin reviewed files absent from the sealed inventory.
    additional={name:digest for name,digest in candidate_drift.items() if name not in old['files']}
actual={}
changes={}
absent=[]
for name, previous in old['files'].items():
    file=workspace/name
    if forward and name in expected_drift and expected_drift[name] is None and not file.exists() and not file.is_symlink():
        changes[name]=None
        absent.append(name)
        continue
    digest=hashlib.sha256(file.read_bytes()).hexdigest()
    actual[name]=digest
    if digest!=previous:
        changes[name]=digest
if changes!=expected_drift:
    raise SystemExit('ONBOARDING_295_SOURCE_INPUT_DELTA '+str(sorted(changes.keys()^expected_drift.keys() | {k for k in changes.keys()&expected_drift.keys() if changes[k]!=expected_drift[k]})))
for name,want in additional.items():
    file=workspace/name
    if not file.is_file() or file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest()!=want:
        raise SystemExit(f'ONBOARDING_{count}_ADDITIONAL_SOURCE_PIN '+name)
    actual[name]=want
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
    if forward and lane=='roster':
        fixture_name='services/api/src/database/project-roster-http-postgres.owned282.spec.ts'
        fixture_file=out/'lanes'/lane/'fixtures'/fixture_name
        fixture=fixture_file.read_text()
        current_fixture=(workspace/'services/api/src/database/project-roster-http-postgres.spec.ts').read_text()
        archived_case='  it("普通借款的后续项目经理审批阻止调出，实际退回后可调出且保留单据",'
        current_case='  it("零星费用的后续项目经理审批阻止调出，退回草稿后可调出且保留单据",'
        next_case='  it("本项目未交接转审和后续节点委托阻止调出，交接或到期后只移除本项目关系",'
        if (fixture.count(archived_case)!=1 or current_fixture.count(current_case)!=1
                or any(text.count(next_case)!=1 for text in (fixture,current_fixture))):
            raise SystemExit('ONBOARDING_329_ROSTER_EXPENSE_CASE_ANCHOR')
        start=fixture.index(archived_case)
        end=fixture.index(next_case,start)
        current_start=current_fixture.index(current_case)
        current_end=current_fixture.index(next_case,current_start)
        fixture_file.write_text(fixture[:start]+current_fixture[current_start:current_end]+fixture[end:])
        profiles[lane]['fixturePins'][fixture_name]=hashlib.sha256(fixture_file.read_bytes()).hexdigest()
    lane_root=out/'lanes'/lane
    entry=lane_root/'entry.cjs'
    text=entry.read_text().replace('290','295').replace('?.size!==289','?.size!==295')
    if forward:
        if text.count('_295_PASSED')!=1:
            raise SystemExit('ONBOARDING_320_STATUS_ANCHOR')
        text=text.replace('_295_PASSED',f'_{count}_PASSED')
    entry.write_text(text)
    runner=lane_root/'onboarding-full.cjs'
    text=runner.read_text()
    if text.count('a1be083076018686dd8afba68c44ff9c75502014')!=1:
        raise SystemExit('ONBOARDING_295_RUNTIME_ANCHOR')
    text=text.replace('a1be083076018686dd8afba68c44ff9c75502014',application_tree)
    if forward and lane=='roster':
        anchor="          return {caseSha256:createHash('sha256').update(test.fullName).digest('hex'),"
        frame=r"          const frame=/\bproject-roster-http-postgres(?:\.owned282)?\.spec\.ts:(\d{1,5}):(\d{1,4})\b/u.exec(failure);"
        if text.count(anchor)!=1:
            raise SystemExit('ONBOARDING_329_ROSTER_FAILURE_FRAME_ANCHOR')
        text=text.replace(anchor, frame+'\n'+anchor+'\n            ...(frame&&{frame:[Number(frame[1]),Number(frame[2])]}),',1)
    runner.write_text(text)
    if count in (331, 332, 334, 346, 349, 350) and lane=='reset-case12':
        subprocess.run(['patch','--batch','--forward','--fuzz=0','--no-backup-if-mismatch','--silent',
                        str(runner),str(plan/'reset-case12-memory-observation.patch')],check=True)
    if lane=='roster':
        seed=lane_root/'onboarding-roster-seed.cjs'
        material=seed.read_bytes()
        if hashlib.sha256(material).hexdigest()!='9646d99e10a4aa3fde4bf7d9c5f4e9bd6a24cae83b5ae2bbeaa3a02e51b01b91' or material.count(b'a1be083076018686dd8afba68c44ff9c75502014')!=1:
            raise SystemExit('ONBOARDING_295_ROSTER_SEED_PREIMAGE')
        seed.write_bytes(material.replace(b'a1be083076018686dd8afba68c44ff9c75502014',application_tree.encode()))
        subprocess.run(['node','--check',str(seed)],check=True)
    staged_scripts = [entry,runner]
    if forward:
        admission = lane_root/'task12-onboarding-282-admission.cjs'
        if hashlib.sha256(admission.read_bytes()).hexdigest()!='799d0d437bc7dee46f6426526b66cededadbf9f50143b929c8f9ff0491578a91':
            raise SystemExit('ONBOARDING_329_FILE_REGISTRY_PREIMAGE')
        subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(admission),
                        str(plan/'onboarding-signed-settlement-registry.patch')],check=True)
        staged_scripts.append(admission)
    for file in staged_scripts:
        subprocess.run(['node','--check',str(file)],check=True)
manifest={'tree':application_tree,'sourceSha':source_record['sourceSha'],'files':actual}
if forward:
    manifest['absent']=sorted(absent)
(out/'workspace-inputs.json').write_text(json.dumps(manifest,ensure_ascii=False)+'\n')
verifier=(archive/'verify-application-source.cjs').read_text()
verifier=verifier.replace(old['tree'],application_tree).replace('return {tree:manifest.tree,',"assert.equal(manifest.sourceSha,require('./contract-finance-source.json').sourceSha);\n  return {sourceSha:manifest.sourceSha,tree:manifest.tree,")
if forward:
    anchor='  for(const [file,want] of Object.entries(rows)){'
    if verifier.count(anchor)!=1:
        raise SystemExit('ONBOARDING_329_ABSENCE_CHECK_ANCHOR')
    verifier=verifier.replace(anchor, '''  for(const file of manifest.absent){
    assert.ok(!Object.hasOwn(rows,file),'ONBOARDING_329_ABSENCE_FIXTURE_CONFLICT');
    assert.throws(()=>fs.lstatSync(path.join(base,file)),{code:'ENOENT'},'ONBOARDING_329_WORKSPACE_EXPECTED_ABSENT');
  }
'''+anchor)
(out/'verify-application-source.cjs').write_text(verifier)
if forward:
    (out/'lanes.json').write_text(json.dumps(profiles,ensure_ascii=False)+'\n')
else:
    (out/'lanes.json').write_bytes((archive/'lanes.json').read_bytes())
installer=out/'installer.cjs'
if historical_settlement:
    subprocess.run(['node', str(plan/'../stage-historical-takeover-333.cjs'), str(out), 'historical-settlement-334'], check=True)
    if expense_witness:
        subprocess.run(['git','apply','--unidiff-zero',str((plan/'../expense-witness/installer.patch').resolve())],
                       cwd=out,check=True)
        if hashlib.sha256(installer.read_bytes()).hexdigest()!='50208a12c5ac61b396655807e87f8c86ea92db83aa2a3297c38f253735ce155d':
            raise SystemExit('ONBOARDING_346_INSTALLER_PREIMAGE')
        if precision:
            subprocess.run(['git','apply','--unidiff-zero',str((plan/'../expense-witness/installer-349.patch').resolve())],
                           cwd=out,check=True)
            if hashlib.sha256(installer.read_bytes()).hexdigest()!='a38d1424c1f096d1ed43cffbdd70f99521281a30d09bf5792261a4bbd3ff540a':
                raise SystemExit('ONBOARDING_349_INSTALLER_PREIMAGE')
        if signed_settlement:
            subprocess.run(['git','apply','--unidiff-zero',str((plan/'../expense-witness/installer-350.patch').resolve())],
                           cwd=out,check=True)
            if hashlib.sha256(installer.read_bytes()).hexdigest()!='092c7fc57d3c8c9a065264cee5b0253b2b91497448198ab02ed46362be6ee2c0':
                raise SystemExit('ONBOARDING_350_INSTALLER_PREIMAGE')
else:
    installer.write_bytes((common/'installer.cjs').read_bytes())
if text_direct or payment_remainder:
    role_patch, marker, old_entry = (plan/'installer-onboarding.patch').read_bytes().rpartition(b'\n@@ -1388,3 ')
    if not marker or old_entry.count(b'module.exports.withInstalled295Onboarding')!=1:
        raise SystemExit('ONBOARDING_330_INSTALLER_ENTRY_ANCHOR')
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(installer)],
                    input=role_patch+b'\n',check=True)
    if expense_witness:
        with installer.open('a') as script:
            script.write("""
module.exports.withInstalled295Onboarding = receipt => {
  const source=require('./contract-finance-source.json');
  const historical=require('./historical-settlement-334-profile.cjs');
  const consume=async context=>{
    historical.assertFinanceInstallation(receipt,{...source,tails:source.tails.slice(0,39)});
    const verify=async ()=>
      assertOutsideWitness(289,JSON.parse((await context.sql(outsideWitnessSql(289,true,true))).stdout.trim()));
    await verify();
    await require('./onboarding-full.cjs').run(context,receipt);
    await verify();
    receipt.sameInstancePostConsume=true;
  };
SOURCE_RECEIPT  return require('./payment-execution-EXPENSE_COUNT.cjs').install(receipt,consume,source);
};
""".replace('EXPENSE_COUNT',str(count))
                     .replace('SOURCE_RECEIPT','  receipt.sourceSha=source.sourceSha;\n' if signed_settlement else ''))
    else:
        profile_name,installer_method={
            330: ('text-direct-330-profile.cjs','withCombined330TextAgreement'),
            331: ('payment-remainder-331-profile.cjs','withCombined331PaymentRemainder'),
            332: ('upward-archive-332-profile.cjs','withCombined332UpwardArchive'),
            334: ('historical-settlement-334-profile.cjs','withCombined334HistoricalSettlement'),
        }[count]
        with installer.open('a') as script:
            script.write("""
module.exports.withInstalled295Onboarding = receipt => {
  const source=require('./contract-finance-source.json');
  const profile=require('./PROFILE_NAME');
  profile.assertSource(source,source.sourceSha,require('./multi-witness.cjs').final);
  const consume=async context=>{
    profile.assertInstallation(receipt,source);
    const verify=async ()=>
      assertOutsideWitness(289,JSON.parse((await context.sql(outsideWitnessSql(289,trueUPWARD_ARCHIVE_ARG))).stdout.trim()));
    await verify();
    await require('./onboarding-full.cjs').run(context,receipt);
    await verify();
    receipt.sameInstancePostConsume=true;
  };
  return module.exports.INSTALLER_METHOD(receipt,consume,{
    sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
  });
};
""".replace('PROFILE_NAME',profile_name).replace('INSTALLER_METHOD',installer_method)
                     .replace('UPWARD_ARCHIVE_ARG',',true' if upward_archive else '')
                     .replace('profile.assertSource(source,source.sourceSha,', 'profile.assertSource(source,' if historical_settlement else 'profile.assertSource(source,source.sourceSha,')
                     .replace('profile.assertInstallation', 'profile.assertFinanceInstallation' if historical_settlement else 'profile.assertInstallation'))
else:
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(installer),str(plan/'installer-onboarding.patch')],check=True)
if count==334 and hashlib.sha256(installer.read_bytes()).hexdigest() != '12ab29cc7ebd344552362cec76aa7d178fd2e7887363ff18a1cb74614088d10d':
    raise SystemExit('ONBOARDING_334_INSTALLER_POSTIMAGE')
expense_installer_pins = {
    346: '24c6a40b9c09729661eeb8dac4916b8e2c3249489c264b355c3c59d41f4b2e04',
    349: 'ffc7376f8c65a98b5ddb8b3da01254c10957f306e4abe83531c38221e79b5238',
    350: '21fc66adb737dcdfff3f32377eba14c650b87101b16599a73d92f4fa03b7c98f',
}
if expense_witness and hashlib.sha256(installer.read_bytes()).hexdigest() != expense_installer_pins[count]:
    raise SystemExit(f'ONBOARDING_{count}_INSTALLER_POSTIMAGE')
subprocess.run(['node','--check',str(installer)],check=True)
for file in [out/'workspace-inputs.json',out/'verify-application-source.cjs',out/'lanes.json',installer]:
    file.chmod(0o644)
