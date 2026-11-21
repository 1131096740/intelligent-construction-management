from pathlib import Path
import hashlib,json,subprocess,sys
plan,previous,context=map(Path,sys.argv[1:])
workspace=context/'workspace'
def sha(file): return hashlib.sha256(file.read_bytes()).hexdigest()
def need(ok,code):
    if not ok: raise SystemExit(code)
def patch(target,delta,pins):
    need(sha(target)==pins['base'] and sha(delta)==pins['patch'],'TASK398_BROWSER_FIXED_PREIMAGE')
    subprocess.run(['patch','--silent','-F','0',str(target),str(delta)],check=True)
    need(sha(target)==pins['result'],'TASK398_BROWSER_FIXED_POSTIMAGE')
def inventory():
    paths=sorted(workspace.rglob('*'))
    need(not any(p.is_symlink() for p in paths),'TASK398_BROWSER_WORKSPACE_LINK')
    return {p.relative_to(workspace).as_posix():sha(p) for p in paths if p.is_file()}
def digest(data):
    return hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

profile=json.loads((plan/'assembly-pins.json').read_text())
patch(context/'installer.cjs',plan/'installer.patch',profile['installer'])
fixtures=plan/'fixtures'
for target,fingerprint in profile['pol109FixturePins'].items():
    name=Path(target).name
    source=previous/'fixtures'/name
    expected=profile['pol109Launcher']['base'] if name=='task12-pol109-ci.cjs' else fingerprint
    target_file=workspace/target
    need(not target_file.exists() and sha(source)==expected,'TASK398_BROWSER_HISTORICAL_COMPACTION_FIXTURE')
    target_file.write_bytes(source.read_bytes())
    if name=='task12-pol109-ci.cjs':
        patch(target_file,fixtures/(name+'.patch'),profile['pol109Launcher'])
    need(sha(target_file)==fingerprint,'TASK398_BROWSER_HISTORICAL_FIXTURE_POSTIMAGE')
base=inventory()
need(digest(base)==profile['originalScope']['before'],'TASK398_BROWSER_290_BASE_CLOSURE')
for target,pins in profile['browserOverlays'].items():
    path=workspace/target
    if 'verbatim' in pins:
        source=fixtures/path.name
        need(not path.exists() and sha(source)==pins['verbatim'],'TASK398_BROWSER_FIXED_ADDITION')
        path.write_bytes(source.read_bytes())
    else:
        patch(path,fixtures/(path.name+'.patch'),pins)
result=inventory()
need(len(result)==profile['originalScope']['count'] and digest(result)==profile['originalScope']['after'],'TASK398_BROWSER_290_RUNTIME_CLOSURE')
need(sorted(key for key in base.keys()|result.keys() if base.get(key)!=result.get(key))==sorted(profile['browserOverlays']),'TASK398_BROWSER_290_OVERLAY_SCOPE')
(context/'workspace-inputs.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'workspaceFiles':len(result),'browserOverlays':len(profile['browserOverlays'])}))
