#!/bin/bash
set -euo pipefail
umask 077
mode=${1:-successor}
[[ $# -le 1 && ( $mode == successor || $mode == predecessor || $mode == settlement || $mode == template || $mode == draft || $mode == v7 || $mode == invoice || $mode == pol279 || $mode == pol280 || $mode == pfq || $mode == pol108-core || $mode == pol108-facts || $mode == pol108-impacts || $mode == pol109 || $mode == pol275 || $mode == expense-execution || $mode == expense-finance || $mode == expense-receipt || $mode == payment-execution ) ]]
root=$(git rev-parse --show-toplevel)
input="$root/.github/task12-install-290"
previous="$root/.github/task12-install-289"
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-task12-290.XXXXXXXX")
mkdir -m 0755 "$temp/product"
(umask 022; node "$input/materialize.cjs" --materialize "$root" "$temp/product" "$CI_SOURCE_SHA")
node "$previous/verify.cjs" "$temp/product/predecessor"
(umask 022; python3 "$previous/produce.py" "$root" "$CI_SOURCE_SHA" "$previous/historical-install-inputs.tar.gz" "$previous/installer.cjs" "$temp/admission")
mkdir "$temp/context"
(umask 022; cp -R "$temp/admission/source" "$temp/context/")
cp "$temp/admission"/{source-seal.txt,source-admission.json} "$temp/context/"
cp "$previous"/{Dockerfile,checkout.cjs,installer.cjs,exact-source.json} "$temp/context/"
if [[ $mode == predecessor ]]; then
  cp "$previous/install-only.cjs" "$temp/context/"
else
  cp "$input"/{successor.cjs,install-only.cjs} "$temp/context/"
  cp "$temp/product/successor.sql" "$temp/context/"
  python3 - "$input" "$temp/context" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
input_dir,context=map(Path,sys.argv[1:])
profile=json.loads((input_dir/'profile.json').read_bytes())
pins=profile['installerAssembly']
base=context/'installer.cjs'
delta=input_dir/'installer.patch'
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
if sha(base)!=pins['baseSha256'] or sha(delta)!=pins['patchSha256']:
    raise SystemExit('EXACT_290_INSTALLER_INPUT')
subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
if sha(base)!=pins['resultSha256']:
    raise SystemExit('EXACT_290_INSTALLER_POSTIMAGE')
scope={key:profile[key] for key in ('tree','prefixCount','prefixLedgerSha256','terminal','expectedLedgerSha256')}
(context/'scope.json').write_text(json.dumps(scope,separators=(',',':'))+'\n')
PY
  printf '%s\n' 'COPY --chmod=644 successor.cjs scope.json successor.sql /qualification/' >> "$temp/context/Dockerfile"
fi
entry_args=()
case "$mode" in
  expense-execution|expense-finance|expense-receipt)
    mkdir -m 0755 "$temp/context/workspace"
    (umask 022; bash "$previous/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement290)
    cp "$previous/contract-ci.cjs" "$temp/context/"
    cat "$previous/settlement.Dockerfile" >> "$temp/context/Dockerfile"
    (umask 022; python3 "$input/expense/stage.py" "$input/expense" "$temp/context/installer.cjs" "$temp/expense")
    ;;
  payment-execution)
    mkdir -m 0755 "$temp/context/workspace"
    (umask 022; bash "$previous/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement290)
    cp "$previous/contract-ci.cjs" "$temp/context/"
    cat "$previous/settlement.Dockerfile" >> "$temp/context/Dockerfile"
    (umask 022; python3 "$input/payment/stage.py" "$input/payment" "$temp/context/installer.cjs" "$temp/payment")
    ;;
  pol275)
    (umask 022; bash "$previous/pol275/workspaces.sh" "$root" "$CI_SOURCE_SHA" "$temp/context" settlement290)
    (umask 022; cp -R "$previous/pol275" "$temp/")
    python3 - "$input" "$temp/pol275" <<'PYPOL275'
from pathlib import Path
import hashlib,json,subprocess,sys
source,target=map(Path,sys.argv[1:])
pins=json.loads((source/'profile.json').read_text())['pol275Assembly']
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
for name,pin in pins.items():
    base=target/name
    delta=source/('pol275-'+name+'.patch')
    if sha(base)!=pin['baseSha256'] or sha(delta)!=pin['patchSha256']:
        raise SystemExit('EXACT_290_POL275_INPUT')
    subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
    if sha(base)!=pin['resultSha256']:
        raise SystemExit('EXACT_290_POL275_POSTIMAGE')
PYPOL275
    cp "$temp/pol275/base-pol275.cjs" "$temp/context/pol275.cjs"
    cat "$previous/pol275/Dockerfile" >> "$temp/context/Dockerfile"
    ;;
  pol109)
    mkdir -m 0755 "$temp/context/workspace"
    (umask 022; git -C "$root" archive "$CI_SOURCE_SHA" package.json pnpm-workspace.yaml pnpm-lock.yaml scripts packages/shared-domain services/api apps/web-admin | tar xf - -C "$temp/context/workspace")
    for file in database-dynamic-gate-manifest.json run-database-dynamic-gate-local.cjs; do
      path="services/api/prisma/$file"
      (umask 022; git -C "$root" show "0a5b607cf912ffbb50237af2608ac8b2a5360c16:$path" > "$temp/context/workspace/$path")
    done
    install -m 0644 "$previous/fixtures"/task12-pol109-{ci,stage-browser,stage-workspace}.cjs "$temp/context/workspace/services/api/prisma/"
    install -m 0644 "$previous/fixtures/project-close-profit.owned282.http.pg.spec.ts" "$temp/context/workspace/services/api/src/project-close-profit/"
    cp "$previous/pol109-workspace-proof.cjs" "$temp/context/workspace-proof.cjs"
    cp "$previous/pol109-entry.cjs" "$temp/context/pol109-entry.cjs"
    python3 - "$input" "$previous" "$temp/context" <<'PYPOL109'
from pathlib import Path
import hashlib,json,subprocess,sys
source,prior,target=map(Path,sys.argv[1:])
profile=json.loads((source/'profile.json').read_text())['pol109Assembly']
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
files={
 'installer.cjs':target/'installer.cjs',
 'entry.cjs':target/'pol109-entry.cjs',
 'workspace-proof.cjs':target/'workspace-proof.cjs',
 'task12-pol109-ci.cjs':target/'workspace/services/api/prisma/task12-pol109-ci.cjs',
 'project-close-profit.owned282.http.pg.spec.ts':target/'workspace/services/api/src/project-close-profit/project-close-profit.owned282.http.pg.spec.ts',
}
for name,base in files.items():
    pin=profile['inputs'][name]
    delta=source/('pol109-'+name+'.patch')
    if sha(base)!=pin['baseSha256'] or sha(delta)!=pin['patchSha256']:
        raise SystemExit('EXACT_290_POL109_INPUT')
    subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
    if sha(base)!=pin['resultSha256']:
        raise SystemExit('EXACT_290_POL109_POSTIMAGE')
old=prior/'pol109-workspace-inputs.json'
if sha(old)!=profile['workspaceBaseSha256']:
    raise SystemExit('EXACT_290_POL109_MANIFEST_BASE')
inventory={row['path']:row['sha256'] for row in json.loads(old.read_text())}
inventory.update(profile['workspaceDelta'])
root=target/'workspace'
paths=sorted(root.rglob('*'))
actual={f.relative_to(root).as_posix():sha(f) for f in paths if f.is_file()}
if any(f.is_symlink() for f in paths) or actual!=inventory:
    raise SystemExit('EXACT_290_POL109_WORKSPACE')
manifest=(json.dumps([{'path':k,'sha256':v} for k,v in sorted(inventory.items(),key=lambda row:Path(row[0]).parts)],indent=2)+'\n').encode()
if hashlib.sha256(manifest).hexdigest()!=profile['workspaceSha256']:
    raise SystemExit('EXACT_290_POL109_MANIFEST')
(target/'workspace-inputs.json').write_bytes(manifest)
PYPOL109
    cp "$temp/context/pol109-entry.cjs" "$temp/context/install-only.cjs"
    cat "$previous/pol109.Dockerfile" >> "$temp/context/Dockerfile"
    ;;
  pfq)
    mkdir -m 0755 "$temp/context/workspace"
    (umask 022; bash "$previous/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement290)
    cp "$previous/contract-ci.cjs" "$temp/context/"
    cat "$previous/settlement.Dockerfile" >> "$temp/context/Dockerfile"
    (umask 022; cp -R "$previous/pfq" "$temp/")
    python3 - "$input" "$temp/pfq" <<'PYPFQ'
from pathlib import Path
import hashlib,json,subprocess,sys
source,target=map(Path,sys.argv[1:])
pins=json.loads((source/'profile.json').read_text())['pfqAssembly']
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
for name,profile in pins.items():
    base=target/name
    delta=source/('pfq-'+base.stem+'.patch')
    if sha(base)!=profile['baseSha256'] or sha(delta)!=profile['patchSha256']:
        raise SystemExit('EXACT_290_PFQ_INPUT')
    subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
    if sha(base)!=profile['resultSha256']:
        raise SystemExit('EXACT_290_PFQ_POSTIMAGE')
PYPFQ
    ;;
  settlement|template|draft|v7|invoice|pol279|pol280|pol108-*)
    python3 - "$input" "$temp/context" <<'PYCONTRACT'
from pathlib import Path
import hashlib,json,subprocess,sys
plan,context=map(Path,sys.argv[1:])
profile=json.loads((plan/'profile.json').read_text())['contractInstallerAssembly']
delta=plan/'contract-installer.patch'
base=context/'installer.cjs'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
if sha(base)!=profile['baseSha256'] or sha(delta)!=profile['patchSha256']:
    raise SystemExit('EXACT_290_CONTRACT_INSTALLER_INPUT')
subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
if sha(base)!=profile['resultSha256']:
    raise SystemExit('EXACT_290_CONTRACT_INSTALLER_POSTIMAGE')
PYCONTRACT
    mkdir -m 0755 "$temp/context/workspace"
    (umask 022; bash "$previous/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement290)
    case "$mode" in
      invoice)
        install -m 0644 "$previous/fixtures/invoice-ledger.postgres.spec.ts" "$temp/context/workspace/services/api/src/invoice-ledger/" ;;
      template)
        install -m 0644 "$previous/fixtures/contract-template-scenario-concurrency.spec.ts" "$temp/context/workspace/services/api/src/database/" ;;
      draft)
        install -m 0644 "$previous/fixtures/settlement-draft-lifecycle-concurrency.spec.ts" "$temp/context/workspace/services/api/src/database/"
        python3 - "$input/profile.json" "$previous/fixtures/database-dynamic-gate-manifest.json" "$temp/context/workspace/services/api/prisma/database-dynamic-gate-manifest.json" <<'PYDRAFT'
from pathlib import Path
import hashlib,json,sys
profile_path,base,out=map(Path,sys.argv[1:])
profile=json.loads(profile_path.read_text())
manifest=json.loads(base.read_text())
manifest['migrationBaseline'].update(expectedDirectoryCount=profile['prefixCount']+1,
    terminalMigration=profile['terminal']['name'],terminalMigrationChecksum=profile['terminal']['sha256'])
data=(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()
if hashlib.sha256(data).hexdigest()!=profile['contractInstallerAssembly']['draftManifestSha256']:
    raise SystemExit('EXACT_290_DRAFT_MANIFEST')
out.write_bytes(data)
PYDRAFT
        chmod 0644 "$temp/context/workspace/services/api/prisma/database-dynamic-gate-manifest.json"
        ;;
    esac
    cp "$previous/contract-ci.cjs" "$temp/context/"
    cp "$input/contract-entry.cjs" "$temp/context/install-only.cjs"
    cat "$previous/settlement.Dockerfile" >> "$temp/context/Dockerfile"
    case "$mode" in
      v7|invoice|pol279)
        cp "$previous/fresh-owner289.cjs" "$temp/context/"
        printf '%s\n' 'COPY --chmod=644 fresh-owner289.cjs /qualification/' >> "$temp/context/Dockerfile"
        ;;
    esac
    if [[ $mode == pol280 ]]; then
      cp "$previous/pol280.cjs" "$temp/context/"
      printf '%s\n' 'COPY --chmod=644 pol280.cjs /qualification/' >> "$temp/context/Dockerfile"
    fi
    if [[ $mode == pol108-* ]]; then
      cp "$previous"/{pol108-289.cjs,pol108-observability.cjs,pol108-shards.cjs} "$temp/context/"
      install -m 0644 "$previous/fixtures/jest.runtime.config.cjs" "$temp/context/workspace/services/api/"
      if [[ $mode == pol108-core ]]; then
        install -m 0644 "$previous/fixtures/operating-projection-postgresql.cases.ts" "$temp/context/workspace/services/api/src/database/"
      fi
      python3 - "$input" "$temp/context" "$mode" <<'PYPOL108'
from pathlib import Path
import hashlib,json,subprocess,sys
source,target=map(Path,sys.argv[1:3])
mode=sys.argv[3]
pins=json.loads((source/'profile.json').read_text())['pol108Assembly']
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
files=[target/'pol108-289.cjs']
if mode=='pol108-core':
    files.append(target/'workspace/services/api/src/database/operating-projection-postgresql.cases.ts')
for base in files:
    pin=pins[base.name]
    delta=source/(base.name+'.patch')
    if sha(base)!=pin['baseSha256'] or sha(delta)!=pin['patchSha256']:
        raise SystemExit('EXACT_290_POL108_INPUT')
    subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
    if sha(base)!=pin['resultSha256']:
        raise SystemExit('EXACT_290_POL108_POSTIMAGE')
PYPOL108
      printf '%s\n' 'COPY --chmod=644 pol108-289.cjs pol108-observability.cjs pol108-shards.cjs /qualification/' >> "$temp/context/Dockerfile"
    fi
    entry_args=("$mode")
    ;;
esac
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/context"
image=$(cat "$temp/image.id")
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
if [[ $mode == payment-execution ]]; then
  exec bash "$input/payment/run-lanes.sh" "$image" "$temp/product/predecessor" "$temp/payment" "$temp/product/successor.sql"
fi
if [[ $mode == expense-* ]]; then
  exec bash "$input/expense/run-lanes.sh" "${mode#expense-}" "$image" "$temp/product/predecessor" "$temp/expense"
fi
if [[ $mode == pol275 ]]; then
  exec bash "$temp/pol275/run-lanes.sh" "$image" "$temp/product/predecessor"
fi
if [[ $mode == pfq ]]; then
  exec bash "$temp/pfq/run-lanes.sh" "$image" "$temp/product/predecessor"
fi
fixture_pids=256
fixture_tmpfs=512m
if [[ $mode == pol108-* ]]; then fixture_pids=128; fi
case "$mode" in pol108-facts) fixture_tmpfs=1g ;; pol108-impacts) fixture_tmpfs=2g ;; esac
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit "$fixture_pids" --memory 4g --user postgres --init \
  --tmpfs /tmp:rw,noexec,nosuid,size="$fixture_tmpfs" \
  --mount "type=bind,src=$temp/product/predecessor,dst=/qualification/product,readonly" \
  --entrypoint node "$image" /qualification/install-only.cjs "${entry_args[@]}"
