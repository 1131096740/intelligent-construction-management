from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

prev, old, common, workspace, source, out = map(Path,sys.argv[1:])
out.mkdir()
profile=json.loads((old/'profile.json').read_text())['pol109Assembly']
source_record=json.loads(source.read_text())
if source_record['migrationCount']!=295:
    raise SystemExit('POL109_295_SOURCE')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
def patch(file,delta):
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(file),str(delta)],check=True)

staged={}
for name in ['task12-pol109-ci.cjs','task12-pol109-stage-browser.cjs','task12-pol109-stage-workspace.cjs',
             'project-close-profit.owned282.http.pg.spec.ts']:
    dest=('services/api/prisma/' if name.endswith('.cjs') else 'services/api/src/project-close-profit/')+name
    if (workspace/dest).exists():
        raise SystemExit('POL109_295_OVERLAY_CONFLICT '+dest)
    target=out/name
    target.write_bytes((prev/'fixtures'/name).read_bytes())
    pin=profile['inputs'].get(name)
    if pin:
        delta=old/('pol109-'+name+'.patch')
        if sha(target)!=pin['baseSha256'] or sha(delta)!=pin['patchSha256']:
            raise SystemExit('POL109_290_OVERLAY_PREIMAGE '+name)
        patch(target,delta)
        if sha(target)!=pin['resultSha256']:
            raise SystemExit('POL109_290_OVERLAY_POSTIMAGE '+name)
    staged[dest]=target

def exactly(text,needle,new):
    if text.count(needle)!=1:
        raise SystemExit('POL109_295_ORIGINAL_ANCHOR '+needle)
    return text.replace(needle,new)

for target in [out/'project-close-profit.owned282.http.pg.spec.ts',out/'task12-pol109-ci.cjs']:
    text=target.read_text()
    text=exactly(text,'count(*) = 290' if target.suffix=='.ts' else 'count(*)=290',
                      'count(*) = 295' if target.suffix=='.ts' else 'count(*)=295')
    old_terminal="'20261119003500_fund_balance_correction_controlled_round'"
    old_hash="'8ea8b2a9c78210a7c4e42f4ddf7224fada84b2c4692dfbecc41477d3a8704f60'"
    text=exactly(text,old_terminal,"'20261119003800_company_transfer_ordinary_loan_multi_witness'")
    text=exactly(text,old_hash,"'e5b56cb299eb4a51eb094267fbf302b6fa6b40b31c0337c6dfcf628694d5de25'")
    if target.suffix=='.cjs':
        old_spec=profile['inputs']['project-close-profit.owned282.http.pg.spec.ts']['resultSha256']
        text=exactly(text,old_spec,sha(out/'project-close-profit.owned282.http.pg.spec.ts'))
        text=exactly(text,'a1be083076018686dd8afba68c44ff9c75502014','67644d9465a0ab4ee80ede099139d9c129d66f14')
        text=exactly(text,"path.join(context.workDir,'prefixes/combined289/schema.prisma')",'context.combinedSchemaPath')
    target.write_text(text)

# The labeled image binds the complete input context before this runtime readback.
paths=sorted(workspace.rglob('*'))
if any(file.is_symlink() for file in paths):
    raise SystemExit('POL109_295_SOURCE_LINK')
rows={file.relative_to(workspace).as_posix():sha(file) for file in paths if file.is_file()}
rows.update({dest:sha(file) for dest,file in staged.items()})
inventory=out/'workspace-inputs.json'
inventory.write_text(json.dumps({'sourceSha':source_record['sourceSha'],
    'rows':[{'path':name,'sha256':value} for name,value in sorted(rows.items())]},indent=2)+'\n')
proof=(prev/'pol109-workspace-proof.cjs').read_text()
proof=exactly(proof,'a9214ab07931a9be3cc5ca94b802e395e01f3bc21cb3efed2a759365caf1caf6',sha(inventory))
proof=exactly(proof,'  for(const row of JSON.parse(bytes)) {',"""  const material=JSON.parse(bytes);
  if(material.sourceSha!==require('./contract-finance-source.json').sourceSha) throw new Error('POL109_SOURCE_SHA');
  for(const row of material.rows) {""")
(out/'workspace-proof.cjs').write_text(proof)
for file in out.iterdir():
    file.chmod(0o644)
