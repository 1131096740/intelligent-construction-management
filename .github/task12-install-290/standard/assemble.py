from pathlib import Path
import hashlib,json,subprocess,sys
plan,context=map(Path,sys.argv[1:])
workspace=context/'workspace'
fixtures=plan/'fixtures'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
def need(ok, code):
    if not ok:
        raise SystemExit(code)
def patch(base, delta, pins):
    need(sha(base)==pins['base'] and sha(delta)==pins['patch'],'STANDARD_290_FIXED_PREIMAGE')
    subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
    need(sha(base)==pins['result'],'STANDARD_290_FIXED_POSTIMAGE')
def inventory(root):
    paths=sorted(root.rglob('*'))
    need(not any(p.is_symlink() for p in paths),'STANDARD_290_WORKSPACE_LINK')
    return {p.relative_to(root).as_posix():sha(p) for p in paths if p.is_file()}
def canonical(data):
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

profile=json.loads((plan/'assembly-pins.json').read_text())
patch(context/'installer.cjs',plan/'installer.patch',profile['installer'])
pins=json.loads((fixtures/'fixed-overlay-pins.json').read_text())
source=workspace/'services/api/src'
exact=inventory(source)
need(canonical(exact)==profile['sourceClosure']['exact'],'STANDARD_290_EXACT_SOURCE')
for target, pin in pins.items():
    base=workspace/target
    need(target.startswith(('services/api/src/database/','services/api/prisma/')),'STANDARD_290_FIXTURE_SCOPE')
    if 'verbatim' in pin:
        copy=fixtures/base.name
        need(not base.exists() and sha(copy)==pin['verbatim'],'STANDARD_290_FIXED_ADDITION')
        base.write_bytes(copy.read_bytes())
    else:
        patch(base,fixtures/(base.name+'.patch'),pin)
actual=inventory(source)
different=sorted(key for key in exact.keys()|actual.keys() if exact.get(key)!=actual.get(key))
need(different==profile['sourceClosure']['overlays'] and canonical(actual)==profile['sourceClosure']['actual'],'STANDARD_290_RUNTIME_SOURCE')
need(sorted(Path(f).name for f in pins if f.startswith('services/api/prisma/'))==profile['prismaOverlays'],'STANDARD_290_PRISMA_OVERLAYS')
(context/'app-inputs.json').write_text(json.dumps({'exact':exact,'actual':actual,'authorizedTestOverlays':different},indent=2)+'\n')
print(json.dumps({'workspaceFiles':len(inventory(workspace)),'sourceFiles':len(actual),'pinnedOverlays':len(pins)}))
