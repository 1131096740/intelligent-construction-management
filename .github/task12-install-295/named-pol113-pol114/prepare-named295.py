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
source_mode = source.get('mode')
company = source_mode == 'company-history-352'
signed_settlement = company or source_mode == 'signed-settlement-350'
if signed_settlement and os.environ.get('GITHUB_ACTIONS') == 'true':
    sys.exit(64)
precision = signed_settlement or source_mode == 'expense-witness-349'
expense_witness = precision or source_mode == 'expense-witness-346'
historical_settlement = source_mode == 'historical-settlement-334' or expense_witness
upward_archive = source_mode == 'upward-archive-332' or historical_settlement
payment_remainder = upward_archive or source_mode == 'payment-remainder-331'
text_direct = payment_remainder or source_mode == 'text-direct-330'
current320 = text_direct or source_mode == 'current-320'
mode = [f'--{source_mode}'] if current320 else []
ledger329 = '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2'
previous = source['predecessor'] if current320 else source
assert previous['migrationCount'] == 295 and len(previous['tails']) == 3
if current320:
    expected_count = {'current-320': 329, 'text-direct-330': 330, 'payment-remainder-331': 331, 'upward-archive-332': 332, 'historical-settlement-334': 334, 'expense-witness-346': 346, 'expense-witness-349': 349, 'signed-settlement-350': 350, 'company-history-352': 352}
    assert count == expected_count[source_mode] and len(source['tails']) == count - 295
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
pins = json.loads(read_pinned(donor/'pins.json','dc752a3d2e85b05805e56cb746b6e873c5a8b4ef1fddb3b96e257e66b2524c80'))
old_installer = overlay((native/'installer.cjs').read_bytes(),pins['installer'])
new_installer = patch(old_installer,(plan/'installer-named295.patch').read_bytes())
assert digest(new_installer) == 'e94bd046c552817cbd49cfb86c693ea0e0496d93f677f99801f90dfad835a7ef'
if current320:
    new_installer = patch(new_installer,(plan/'installer-named320.patch').read_bytes())
if text_direct:
    new_installer = patch(new_installer,(plan/'installer-named330.patch').read_bytes())
if payment_remainder:
    assert digest(new_installer) == 'd8890d056b01e0f3024f557c98937a358bc326b4ec6cabedf765eb27096f1966'
    remainder_patch = read_pinned(plan/'installer-named331.patch','1b9587ed98984fce51b875f548c4511c0b224ab3eff8000f7d846408c126ce84')
    new_installer = patch(new_installer,remainder_patch)
    assert digest(new_installer) == 'd9212c0ddb78d8feb513b446a8b8eb59f67c8508e1d29fe4de790ff9c143a0dd'
if upward_archive:
    archive_patch = read_pinned(plan/'installer-named332.patch','178e348ef894be6f3c4d6470a6ddfacb2f9b1a0001b8c8ee62c939d78fa5e998')
    new_installer = patch(new_installer,archive_patch)
    assert digest(new_installer) == 'b26779cd68adfd38dfe39b9546d39909ebe06c94624b633ecd7e6557dbe3dc39'
if historical_settlement:
    historical_patch = read_pinned(plan/'installer-named334.patch','e06fa97dd882a1609107007c7ed45b79c145250129efc34107c32bc9a073e9dc')
    new_installer = patch(new_installer,historical_patch)
    assert digest(new_installer) == '6bf3a87b1630e1d36afeba0f56e29c9941f3468ec49a7ac96976b8df14c95002'
    for profile in ('historical-takeover-333-profile.cjs', 'historical-settlement-334-profile.cjs'):
        write(context/profile,(common.parent/profile).read_bytes())
if expense_witness:
    expense_patch = read_pinned(plan/'installer-named346.patch','f188638f0107ee0ecce941f46e5253272b17c24a81fbf847cc86b3cf8c26a3d6')
    new_installer = patch(new_installer,expense_patch)
    assert digest(new_installer) == 'f37863078cddb9ef0577e2fa43c69a320d4a0a0c4f4d1eb0f4495a51ee8fe488'
    for profile in ('expense-witness-345-profile.cjs', 'expense-witness-346-profile.cjs', 'expense-witness-prefixes.json'):
        write(context/profile,(common.parent/profile).read_bytes())
if precision:
    precision_patch = read_pinned(plan/'installer-named349.patch','1d75d6434243c0691cd70f7f5e624c35188210f499d159782378151110b2c9c9')
    new_installer = patch(new_installer,precision_patch)
    assert digest(new_installer) == 'a7738cbc9bc72738431e26393baae504fa4791566a16afa6a2085de1b334ce84'
    profile = 'expense-witness-349-profile.cjs'
    write(context/profile,read_pinned(common.parent/profile,'85770028fffad317bf8e09d88d6ae8954bf24d822ab2766ef1bf40b1d7b1de98'))
if signed_settlement:
    signed_patch = read_pinned(plan/'installer-named350.patch','ad8b5340aae72a0f9a4f35dd3b497d960cae766cf606867dca06cd2ffae8e28a')
    new_installer = patch(new_installer,signed_patch)
    assert digest(new_installer) == '53744e35109a6260a5113366cf5d88075dcbb35d8f8d476e802a45b422866106'
    profile = 'signed-settlement-350-profile.cjs'
    write(context/profile,subprocess.check_output(['git','-C',str(repo),'show',f'{ref}:{common.parent.relative_to(repo)}/{profile}']))
if company:
    company_patch = read_pinned(plan/'installer-named352.patch','44335ea8bb26c8b84b84e5cf92657403677a2fbf1d2d109e0c026493e6322c3f')
    new_installer = patch(new_installer,company_patch)
    assert digest(new_installer) == '6d110dd5500ed36af32aec9f87ef5689a54c509dbb03db1cd99ecd1c18b07656'
    profile = 'company-history-352-profile.cjs'
    write(context/profile,subprocess.check_output(['git','-C',str(repo),'show',f'{ref}:{common.parent.relative_to(repo)}/{profile}']))
write(context/'installer.cjs',new_installer)
for name, pin in pins['runtime'].items():
    material = read_pinned(repo/pin['repoFile'] if 'repoFile' in pin else donor/pin['file'],pin['digest'])
    if name == 'install-only.cjs':
        material = patch(material,(plan/'entry-named295.patch').read_bytes())
        assert digest(material) == '25ecadbca109001a672b9879d34bebedbdc14a964506ab5eed539b6ff4d5f47d'
        if current320:
            replacements = {
                b'const {withNamedPol113Pol114295}': b'const {withNamedPol113Pol114320}',
                b"NAMED_POL113_POL114_EXACT_295',mode": b"NAMED_POL113_POL114_EXACT_329',mode",
                b'await withNamedPol113Pol114295(receipt': b'await withNamedPol113Pol114320(receipt',
                b"receipt.orderedTails.slice(-6).map(({size})=>size),[290,291,292,293,294,295]":
                    b"receipt.orderedTails.slice(-7).map(({size})=>size),[290,291,292,293,294,295,329]",
                b"  receipt.status='POL113_POL114_NAMED_EXACT_295_PASSED';": b'''  assert.equal(receipt.forward320?.sourceTree,admission.sourceTree);
  assert.equal(receipt.forward320?.ledgerSha256,admission.ledger320);
  assert.deepEqual(receipt.postBehavior320,{exactB7:true,sameIdentity:true,count:329,ledgerSha256:admission.ledger320});
  receipt.status='POL113_POL114_NAMED_EXACT_329_PASSED';''',
            }
            for old, new in replacements.items():
                assert material.count(old) == 1
                material = material.replace(old, new)
            if text_direct:
                source_counts = {
                    b'withNamedPol113Pol114320': b'withNamedPol113Pol114330',
                    b'EXACT_329': b'EXACT_330',
                    b'slice(-7).map(({size})=>size),[290,291,292,293,294,295,329]':
                        b'slice(-8).map(({size})=>size),[290,291,292,293,294,295,329,330]',
                    b'count:329,ledgerSha256:admission.ledger320': b'count:330,ledgerSha256:admission.ledger320',
                }
                for old, new in source_counts.items():
                    assert material.count(old) == (2 if old in (b'withNamedPol113Pol114320',b'EXACT_329') else 1)
                    material = material.replace(old,new)
                prior_witness = b'  assert.equal(receipt.forward320?.sourceTree,admission.sourceTree);'
                assert material.count(prior_witness) == 1
                material = material.replace(prior_witness,b"  assert.deepEqual(receipt.textDirectPredecessor,{count:329,ledgerSha256:admission.ledger329,sameIdentity:true,exactB7:true});\n"+prior_witness)
            if payment_remainder:
                remainder_replacements = {
                    b'withNamedPol113Pol114330': b'withNamedPol113Pol114331',
                    b'EXACT_330': b'EXACT_331',
                    b'slice(-8).map(({size})=>size),[290,291,292,293,294,295,329,330]':
                        b'slice(-9).map(({size})=>size),[290,291,292,293,294,295,329,330,331]',
                    b'count:330,ledgerSha256:admission.ledger320': b'count:331,ledgerSha256:admission.ledger320',
                }
                for old,new in remainder_replacements.items():
                    assert material.count(old) == (2 if old in (b'withNamedPol113Pol114330',b'EXACT_330') else 1)
                    material = material.replace(old,new)
                assert material.count(prior_witness) == 1
                material = material.replace(prior_witness,b"  assert.deepEqual(receipt.paymentRemainderPredecessor,{count:330,ledgerSha256:admission.ledger330,sameIdentity:true,exactB7:true});\n"+prior_witness)
            if upward_archive:
                archive_replacements = {
                    b'withNamedPol113Pol114331': b'withNamedPol113Pol114332',
                    b'EXACT_331': b'EXACT_332',
                    b'slice(-9).map(({size})=>size),[290,291,292,293,294,295,329,330,331]':
                        b'slice(-10).map(({size})=>size),[290,291,292,293,294,295,329,330,331,332]',
                    b'  assert.equal(receipt.forward320?.sourceTree,admission.sourceTree);': b'''  assert.deepEqual(receipt.upwardArchivePredecessor,{count:331,ledgerSha256:admission.ledger331,sameIdentity:true,exactB7:true});
  assert.deepEqual(receipt.orderedTails.slice(-2),[
    {size:331,ledgerSha256:admission.ledger331},{size:332,ledgerSha256:admission.ledger332}
  ]);
  assert.equal(receipt.forward332?.sourceTree,admission.sourceTree);
  assert.equal(receipt.forward332?.count,332);
  assert.equal(receipt.forward332?.sameIdentity,true);
  assert.equal(receipt.forward332?.exactB7,true);''',
                    b'receipt.forward320?.ledgerSha256,admission.ledger320': b'receipt.forward332?.ledgerSha256,admission.ledger332',
                    b'receipt.postBehavior320,{exactB7:true,sameIdentity:true,count:331,ledgerSha256:admission.ledger320}':
                        b'receipt.postBehavior332,{exactB7:true,sameIdentity:true,count:332,ledgerSha256:admission.ledger332}',
                }
                for old,new in archive_replacements.items():
                    assert material.count(old) == (2 if old in (b'withNamedPol113Pol114331',b'EXACT_331') else 1)
                    material = material.replace(old,new)
            if historical_settlement:
                historical_replacements = {
                    b'withNamedPol113Pol114332': b'withNamedPol113Pol114334',
                    b'EXACT_332': b'EXACT_334',
                    b'slice(-10).map(({size})=>size),[290,291,292,293,294,295,329,330,331,332]':
                        b'slice(-12).map(({size})=>size),[290,291,292,293,294,295,329,330,331,332,333,334]',
                    b'receipt.orderedTails.slice(-2),[\n    {size:331,ledgerSha256:admission.ledger331},{size:332,ledgerSha256:admission.ledger332}':
                        b'receipt.orderedTails.slice(-4),[\n    {size:331,ledgerSha256:admission.ledger331},{size:332,ledgerSha256:admission.ledger332},\n    {size:333,ledgerSha256:admission.ledger333},{size:334,ledgerSha256:admission.ledger334}',
                    b'receipt.forward332': b'receipt.forward334',
                    b'receipt.forward334?.count,332': b'receipt.forward334?.count,334',
                    b'receipt.forward334?.ledgerSha256,admission.ledger332': b'receipt.forward334?.ledgerSha256,admission.ledger334',
                    b'receipt.postBehavior332,{exactB7:true,sameIdentity:true,count:332,ledgerSha256:admission.ledger332}':
                        b'receipt.postBehavior334,{exactB7:true,sameIdentity:true,count:334,ledgerSha256:admission.ledger334}',
                    b"  receipt.status='POL113_POL114_NAMED_EXACT_334_PASSED';": b"""  const historical=require('./historical-takeover-333-profile.cjs');
  const settlement=require('./historical-settlement-334-profile.cjs');
  const prior=receipt.historicalTakeoverPredecessor;
  const boundary=receipt.historicalSettlementPredecessor;
  assert.deepEqual([prior.count,prior.ledgerSha256,prior.sameIdentity,prior.exactB7],[332,admission.ledger332,true,true]);
  assert.deepEqual([boundary.count,boundary.ledgerSha256,boundary.sameIdentity,boundary.exactB7],[333,admission.ledger333,true,true]);
  historical.assertCatalog(prior.catalog,false);
  historical.assertCatalog(receipt.historicalTakeover333Catalog,true);
  settlement.assertCatalog(boundary.catalog);
  settlement.assertCatalog(receipt.historicalSettlement334Catalog,boundary.catalog);
  assert.equal(receipt.historicalCatalogAfterBusiness,true);
  receipt.status='POL113_POL114_NAMED_EXACT_334_PASSED';""",
                }
                for old,new in historical_replacements.items():
                    repetitions = 5 if old == b'receipt.forward332' else 2 if old in (b'withNamedPol113Pol114332',b'EXACT_332') else 1
                    assert material.count(old) == repetitions, old
                    material = material.replace(old,new)
            if expense_witness:
                expense_replacements = {
                    b'withNamedPol113Pol114334': b'withNamedPol113Pol114346',
                    b"NAMED_POL113_POL114_EXACT_334',mode": b"NAMED_POL113_POL114_EXACT_346',mode",
                    b'receipt.orderedTails.slice(-12).map(({size})=>size),[290,291,292,293,294,295,329,330,331,332,333,334]':
                        b'receipt.orderedTails.slice(-24).map(({size})=>size),[290,291,292,293,294,295,329,330,331,332,333,334,...Array.from({length:12},(_,i)=>335+i)]',
                    b'receipt.orderedTails.slice(-4),[': b'receipt.orderedTails.slice(-16,-12),[',
                    b'receipt.postBehavior334,{exactB7:true,sameIdentity:true,count:334,ledgerSha256:admission.ledger334}':
                        b'receipt.postBehavior346,{exactB7:true,sameIdentity:true,count:346,ledgerSha256:admission.ledger346}',
                    b"  receipt.status='POL113_POL114_NAMED_EXACT_334_PASSED';": b"""  const expense=require('./expense-witness-346-profile.cjs');
  for (const {size,ledgerSha256} of receipt.orderedTails.slice(-13)) expense.assertPrefix(size,ledgerSha256);
  assert.equal(receipt.forward346?.sourceTree,admission.sourceTree);
  assert.equal(receipt.forward346?.count,346);
  assert.equal(receipt.forward346?.ledgerSha256,admission.ledger346);
  assert.equal(receipt.forward346?.sameIdentity,true);
  assert.equal(receipt.forward346?.exactB7,true);
  assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
  receipt.status='POL113_POL114_NAMED_EXACT_346_PASSED';""",
                }
                for old,new in expense_replacements.items():
                    assert material.count(old) == (2 if old == b'withNamedPol113Pol114334' else 1), old
                    material = material.replace(old,new)
            diagnostic_anchor = b'        ...bootSummary(traces),\n'
            diagnostic = br"""        statuses:traces.flatMap(value=>{
          if(typeof value!=="string")return [];
          const match=/Expected:\s*([1-5][0-9]{2})[\s\S]{0,125}Received:\s*([1-5][0-9]{2})/u.exec(value);
          return match?[{expected:Number(match[1]),actual:Number(match[2])}]:[];
        }).slice(0,3),
        signedChangeFailure:traces.filter(value=>typeof value==="string").map(value=>
          /\bPOL114_SIGNED_CHANGE_(?:BOOT_(?:P[0-9]{4}|EADDRINUSE|EACCES|ECONNREFUSED|UNCLASSIFIED)|HTTP_[1-5][0-9]{2}_(?:OLD_WRITE_ENTRY_RETIRED|OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED|OPERATIONAL_WRITE_FREEZE_ACTIVE|UNCLASSIFIED))\b/u.exec(value)?.[0]
        ).find(Boolean),
        signedSettlementFailure:traces.flatMap(value=>typeof value==="string"
          ? [...value.matchAll(/\bPOL114_SIGNED_SETTLEMENT_(?:(?:PROVISION|SESSION_PRIVILEGES|SESSION|BOOT|CLEANUP|QUERY)_(?:[0-9A-Z]{5}|EADDRINUSE|EACCES|ECONNREFUSED|UNCLASSIFIED)|HTTP_[1-5][0-9]{2}_(?:OPERATIONAL_WRITE_FREEZE_ACTIVE|OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED|OLD_WRITE_ENTRY_RETIRED|UNCLASSIFIED))\b/gu)].map(match=>match[0])
          : []
        ).slice(0,3),
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
    if precision and name == 'install-only.cjs':
        assert digest(material) == '4c4a65347899b0a52b215477b0f105956c6c76288a6dc9962a721e3bb6869818'
        material = patch(material,read_pinned(plan/'entry-named349.patch','7d2f7a6166afb4612092e21b4d884fa15d35f359ef18efd39071188724774d9b'))
        assert digest(material) == '783e7d3732b1187088da35cc59ed1cc0a0218bd72272c07d660cf5f426667102'
        material = patch(material,read_pinned(plan/'pol113-progress-entry-349.patch','75ee80656067d00976f32b46856702f216ee076602e0a81aa1e557e5da90880a'))
        assert digest(material) == '3001fbaf386ad8db695964fa0ad44689a48322fb252c5f93d5cb029d26e35144'
        if signed_settlement:
            material = patch(material,read_pinned(plan/'entry-named350.patch','5e97afc764e58e0119f0414ed335e73780ea8b87e35199ebcd28d9eb02d93e8b'))
            assert digest(material) == '85c7da843c699996df233f72c63740524d115a9e5a25ebc4d38909f374408b44'
            if company:
                material = patch(material,read_pinned(plan/'entry-named352.patch','b82bf7e4ce67d1e30998aa687f03bd0b0252f897bec4b728bf463fe16e528f57'))
                assert digest(material) == '17c8235a558983562a6c203bc6135003da7dd48201702a86da666e476a5570aa'

    if text_direct and name == 'browser-evidence.cjs':
        material = patch(material,(plan/'browser-330-diagnostics.patch').read_bytes())
    write(context/name,material)
if precision:
    write(context/'pol113-progress.cjs',read_pinned(plan/'pol113-progress.cjs','35bfc192bea1804be86ca7a9553f91aed31fb624da2dfa4ba709cb4bac9446f2'))
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
        manifest_count = before['migrationBaseline']['expectedDirectoryCount']
        if signed_settlement and not company:
            assert manifest_count == source['predecessor349']['migrationCount'] == 349
        else:
            assert manifest_count == count or (expense_witness and not precision and manifest_count == 334)
        last = source['tails'][manifest_count - previous['migrationCount'] - 1]
        assert tuple(before['migrationBaseline'][key] for key in keys) == (manifest_count,last['name'],last['sha256'])
        historical_base = subprocess.check_output(['git','-C',str(repo),'show',
            f'233e0d6808352e4b169ec0a82909afc0d3b8f8fa:{name}'])
        original = json.loads(overlay(historical_base,pin))
        for key in keys:
            before['migrationBaseline'][key] = original['migrationBaseline'][key]
        write(path,(json.dumps(before,ensure_ascii=False,indent=2)+'\n').encode())
    else:
        if current320 and name == 'services/api/src/database/contract-business-entry-http.spec.ts':
            # Archived 295 retains serial seal. Current 329 uses an explicit historical V2 input for live finance.
            pin = {**pin,
                   'base': 'a4010bea7e37797d0db81b7333e80878d0d911082f9b35b96d7f4e7b6f91a7f7',
                   'result': '06d1f605177ea7eace47aade609bdc08eed1c00343e8a45a8a5f0eb3c55f9dff',
                   'file': 'patches/contract-business-entry-signed-settlement-current329.spec.ts.gz'}
        if current320 and name == 'services/api/src/database/base-entry-http-postgres.spec.ts':
            pin = {**pin,
                   'base': '2c336da20dd664b623f2b715c49d1963b6c0f3253df433145fa762daf9cfb37b',
                   'result': 'f7153477589137d7cb5bd624686c3926d2a6e676cf04bb05a79cb95862de4343'}
        staged = overlay(material,pin)
        if company and name == 'services/api/src/database/contract-business-entry-http.spec.ts':
            guard = (workspace/'services/api/src/retired-write-entry/retired-write-entry.guard.ts').read_text()
            assert '  { controller: "ProjectController", handler: "requestProjectFinancingQuota" },' in guard
            assert digest(staged) == '06d1f605177ea7eace47aade609bdc08eed1c00343e8a45a8a5f0eb3c55f9dff'
            staged = patch(staged,read_pinned(common.parent/'core-payment-fnd05-history.patch','2cc5cbd8dffd8b4762fa9242c4469c9691c7b99157f010fae534bbe042461719'))
            assert digest(staged) == 'ebf78bc54bd3f9a32c0228e795017768271d26ea50010bf0bbbf471c0dce84da'
        if precision and name == 'apps/web-admin/playwright.pol113-project-real.config.ts':
            assert digest(staged) == '8f3be3ab6820f979b5ed7d764726f0ad999a96a97f5e04fc7689e672b85c1641'
            staged = patch(staged,read_pinned(plan/'pol113-progress-config-349.patch','21dcdcbf00503d075823a11a1031eed7b1e537e8b5a3fdb25520fca6dfc91ec2'))
            assert digest(staged) == '985c19e9c60562c07a33e37bdeb6e4ba19fee576cdfe66b0b8a5abb7b99bb5c0'
        write(path,staged)

files=sorted(p for p in workspace.rglob('*') if p.is_file())
assert not any(p.is_symlink() for p in workspace.rglob('*'))
write(context/'workspace.sha256',''.join(f'{digest(p.read_bytes())}  ./{p.relative_to(workspace).as_posix()}\n' for p in files).encode())
write(context/'candidate-admission.json',(json.dumps({
    'tree':proof['tree'],'candidateSha':ref,'ledger292':proof['combined292'],'ledger295':previous['ledgerSha256'],
    'migrationCount':count,
    **({'ledger329':ledger329} if text_direct else {}),
    **({'ledger330':source['predecessor330']['ledgerSha256']} if payment_remainder else {}),
    **({'ledger331':source['predecessor331']['ledgerSha256'],
        'ledger332':(source['predecessor332']['ledgerSha256'] if historical_settlement else source['ledgerSha256']),
        'sourceTree':source['sourceTree'],'tails':source['tails']} if upward_archive else {}),
    **({'sourceTree':source['sourceTree'],'ledger320':source['ledgerSha256'],'tails':source['tails']}
       if current320 and not upward_archive else {}),
    **({'ledger333':source['predecessor333']['ledgerSha256'],
        'ledger334':source['predecessor334']['ledgerSha256'] if expense_witness else source['ledgerSha256']} if historical_settlement else {}),
    **({'ledger346':source['predecessor346']['ledgerSha256'] if precision else source['ledgerSha256']} if expense_witness else {}),
    **({'sourceMode':source_mode,'ledger349':source['predecessor349']['ledgerSha256']
        if signed_settlement else source['ledgerSha256']} if precision else {}),
    **({'ledger350':source['predecessor350']['ledgerSha256'] if company else source['ledgerSha256']} if signed_settlement else {}),
    **({'ledger352':source['ledgerSha256']} if company else {}),
})+'\n').encode())
docker = read_pinned(donor/'Dockerfile.in','456025c143f993973d1947343c7636565406c74c5a0456addc1e1ff3dcffc24e').decode()
copy = read_pinned(donor/'runtime-copy.txt','de9a7b69c406aa307423a7231ec086b8c6995bd435bfc1fae0bb0dab5d4b40e6').decode().strip()
copy += '\nCOPY --chmod=0644 named295-tail.cjs terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs terminal.sql payout-terminal.sql multi-witness.sql /qualification/'
# Keep profile changes out of the dependency and browser setup layers.
if historical_settlement:
    copy += '\nCOPY --chmod=0644 historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs /qualification/'
if expense_witness:
    copy += '\nCOPY --chmod=0644 expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json /qualification/'
if precision:
    copy += '\nCOPY --chmod=0644 expense-witness-349-profile.cjs pol113-progress.cjs /qualification/'
if signed_settlement:
    copy += '\nCOPY --chmod=0644 signed-settlement-350-profile.cjs /qualification/'
if company:
    copy += '\nCOPY --chmod=0644 company-history-352-profile.cjs /qualification/'
docker = docker.replace('@RUNTIME_COPY@',copy)
write(context/'Dockerfile',docker.encode())
for file in context.glob('*.cjs'):
    subprocess.run(['node','--check',str(file)],check=True)
assert not any(p.is_symlink() for p in context.rglob('*'))
write(out/'context.sha256',''.join(f'{digest(p.read_bytes())}  ./{p.relative_to(context).as_posix()}\n'
    for p in sorted(context.rglob('*')) if p.is_file()).encode())
print(json.dumps({'status':f'NAMED_{count}_PORTABLE_MATERIAL_READY','sourceSha':ref,'workspaceFiles':len(files),'workspaceOverlays':len(pins['workspace'])}))
