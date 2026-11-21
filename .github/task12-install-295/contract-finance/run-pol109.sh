#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=pol109

node -e '
  const source=require(process.argv[1]);
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==295)process.exit(1);
' "$prepared/source.json" "$sha"
image=$(cat "$build/image.id")
fingerprint=$(cat "$build/context.sha256")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
[[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
material="$work/material"
python3 "$plan/stage-pol109.py" "$repo/.github/task12-install-289" "$repo/.github/task12-install-290" "$common" "$prepared/prepared/context/workspace" "$prepared/source.json" "$material"

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=512m" --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/pol109-295-entry.cjs,dst=/qualification/pol109-295-entry.cjs,readonly")
for file in installer.cjs install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi

for file in task12-pol109-ci.cjs task12-pol109-stage-browser.cjs task12-pol109-stage-workspace.cjs; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/workspace/services/api/prisma/$file,readonly")
done
for file in workspace-proof.cjs workspace-inputs.json; do
  args+=(--mount "type=bind,src=$material/$file,dst=/qualification/$file,readonly")
done
spec=project-close-profit.owned282.http.pg.spec.ts
args+=(--mount "type=bind,src=$material/$spec,dst=/qualification/workspace/services/api/src/project-close-profit/$spec,readonly")
printf '%s\n' '验证原项目收口 8 项数据库与 HTTP、5 项浏览器断言在 295 同库通过。观察原 Jest/浏览器计数、同库 B7、Nest 清理。' > "$work/hypothesis.txt"
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/pol109-295-entry.cjs \
  > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]); console.log(JSON.stringify(row));
  if(row.status!=="ORIGINAL_POL109_295_PASSED"||row.sourceSha!==process.argv[2]||process.argv[3]!=="0")process.exit(1);
' "$work/receipt.json" "$sha" "$exit_code" ||
  { printf 'POL109_295_STOPPED %s\n' "$work" >&2; exit 1; }
