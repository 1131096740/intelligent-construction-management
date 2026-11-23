#!/bin/bash
set -euo pipefail
input=$(cd "$(dirname "$0")" && pwd -P)
root=$1
ref=$2
workspace=$3
mode=$4
case "$mode" in settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|settlement290) ;; *) exit 2 ;; esac
git -C "$root" archive "$ref" \
 package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/pnpm-workspace.mjs packages/shared-domain \
 services/api/package.json services/api/tsconfig.json services/api/jest.config.cjs services/api/tsconfig.build.json services/api/nest-cli.json \
 services/api/scripts/operational-write-freeze-policy.cjs services/api/scripts/operational-write-freeze-policy.d.cts \
 services/api/jest.task10-acceptance-paths.cjs services/api/jest.task09-task11-document-acceptance-paths.cjs \
 services/api/src services/api/prisma \
 services/api/assets/templates/{material-purchase-real-v1.docx,equipment-rental-real-v1.docx,labor-subcontract-real-v1.docx,generic-contract-v1.docx} | tar xf - -C "$workspace"
base=0a5b607cf912ffbb50237af2608ac8b2a5360c16
for file in database-dynamic-gate-manifest.json run-database-dynamic-gate-local.cjs; do
  path="services/api/prisma/$file"
  git -C "$root" show "$base:$path" > "$workspace/$path"
done
for file in task12-owned-280.test-support.ts contract-bill-batch-replace-concurrency.spec.ts contract-bill-transition-confirm-concurrency.spec.ts; do
  install -m 644 "$input/fixtures/$file" "$workspace/services/api/src/database/$file"
done
inventory="$input/workspace-inputs.json"
seal=adcefa3b817039e04feb2a82c4d17b6cb6bce559907637ffd273aaaf6b4c0425
if [[ $mode == settlement290 ]]; then
  inventory=-
  seal=e36f3b846e6180a318244f19978494694e852b1285b2b3772a22d738e83d96f9
elif [[ $mode == template ]]; then
  file=contract-template-scenario-concurrency.spec.ts
  install -m 644 "$input/fixtures/$file" "$workspace/services/api/src/database/$file"
  inventory="$input/template-workspace-inputs.json"
  seal=55a90cf9e0df7f3ef007c07c9d26a1de16fcaf9d1f62e76c3358fa2c7996bb61
elif [[ $mode == draft ]]; then
  install -m 644 "$input/fixtures/settlement-draft-lifecycle-concurrency.spec.ts" "$workspace/services/api/src/database/"
  install -m 644 "$input/fixtures/database-dynamic-gate-manifest.json" "$workspace/services/api/prisma/"
  inventory="$input/draft-workspace-inputs.json"
  seal=b75aedee5b14471b90c61c87529952ebc864f05b78d931594e9fdd463727c3dc
elif [[ $mode == pol108-* ]]; then
  install -m 644 "$input/fixtures/jest.runtime.config.cjs" "$workspace/services/api/"
  if [[ $mode == pol108-core ]]; then
    install -m 644 "$input/fixtures/operating-projection-postgresql.cases.ts" "$workspace/services/api/src/database/"
    inventory="$input/pol108-core-workspace-inputs.json"
    seal=b6bc87ac6df3e990320e54f30a4e8887a7f1efb5e71d8ab24a2e42cf6cebe3c4
  else
    inventory="$input/pol108-scale-workspace-inputs.json"
    seal=4307ac3ac7409f1ba5a881a583bba089e58abd60326d772667786e0a7185da73
  fi
elif [[ $mode == invoice ]]; then
  install -m 644 "$input/fixtures/invoice-ledger.postgres.spec.ts" "$workspace/services/api/src/invoice-ledger/"
  inventory="$input/invoice-workspace-inputs.json"
  seal=6d7faea4ad8d113b9f8b57e230be509e9b68da385fd93850b484584b3c7dc9d8
fi
python3 - "$inventory" "$workspace" "$seal" <<'PY'
import hashlib,json,pathlib,sys
inventory, workspace = map(pathlib.Path,sys.argv[1:3])
if str(inventory)!="-" and hashlib.sha256(inventory.read_bytes()).hexdigest()!=sys.argv[3]:
    raise SystemExit('SETTLEMENT_289_WORKSPACE_MANIFEST')
paths=sorted(workspace.rglob('*'))
if any(path.is_symlink() for path in paths):
    raise SystemExit('SETTLEMENT_289_WORKSPACE_LINK')
actual=[dict(path=p.relative_to(workspace).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths if p.is_file()]
if str(inventory)=="-":
    if hashlib.sha256((json.dumps(actual,indent=2)+"\n").encode()).hexdigest()!=sys.argv[3]:
        raise SystemExit("SETTLEMENT_290_WORKSPACE_BYTES")
elif actual != json.loads(inventory.read_bytes()):
    raise SystemExit('SETTLEMENT_289_WORKSPACE_BYTES')
PY
