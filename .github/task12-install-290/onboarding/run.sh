#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
out=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-onboarding-290.XXXXXXXX")
bash "$plan/prepare.sh" "$root" "$CI_SOURCE_SHA" "$out/prepared"
docker build --platform linux/amd64 --iidfile "$out/image.id" "$out/prepared/context"
image=$(cat "$out/image.id")
[[ $image =~ ^sha256:[a-f0-9]{64}$ && $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
lane_names=$(node -e 'console.log(require(process.argv[1]).lanes.join("\n"))' "$plan/pins.json")
run_lane() {
  local lane=$1 pids size dir file
  case "$lane" in
    lifecycle-rest|lifecycle-mobile) pids=256; size=512m ;;
    lifecycle-desktop|downstream|reset-case12|roster-read) pids=512; size=512m ;;
    roster) pids=512; size=768m ;;
    *) exit 2 ;;
  esac
  [[ -z $(docker ps -q) ]]
  if pgrep -x postgres >/dev/null; then exit 1; fi
  local args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
    --security-opt no-new-privileges --pids-limit "$pids" --memory 4g --user postgres --init
    --tmpfs "/tmp:rw,noexec,nosuid,size=$size"
    --mount "type=bind,src=$out/prepared/product/predecessor,dst=/qualification/product,readonly")
  dir="$out/prepared/overlays/lanes/$lane"
  for file in "$dir"/*.cjs "$dir"/*.sql "$dir"/*.json; do
    args+=(--mount "type=bind,src=$file,dst=/qualification/${file##*/},readonly")
  done
  while IFS= read -r file; do
    args+=(--mount "type=bind,src=$file,dst=/qualification/workspace/${file#"$dir/fixtures/"},readonly")
  done < <(find "$dir/fixtures" -type f | LC_ALL=C sort)
  mkdir "$out/$lane"
  docker run "${args[@]}" --entrypoint node "$image" /qualification/preflight.cjs | tee "$out/$lane/preflight.json"
  node - "$out/$lane/preflight.json" "$lane" "$plan/scope.json" <<'JS'
const assert=require('node:assert/strict');
const [file,lane,scopeFile]=process.argv.slice(2);
const proof=require(file),scope=require(scopeFile);
assert.equal(proof.status,'ONBOARDING_290_CONTEXT_NO_DATABASE_VERIFIED');
assert.equal(proof.application.lane,lane);
assert.equal(proof.application.tree,scope.tree);
assert.equal(proof.ledgerCount,290);
assert.equal(proof.ledgerSha256,scope.expectedLedgerSha256);
JS
  [[ -z $(docker ps -q) ]]
  printf '%s\n' '假设 290 同库续装可保留原具名角色行为。观察同库账本、两项撤权、所选原用例与清理。' > "$out/$lane/hypothesis.txt"
  docker run "${args[@]}" --entrypoint node "$image" /qualification/entry.cjs | tee "$out/$lane/receipt.json"
  node "$plan/verify-receipts.cjs" "$out" "$lane"
}
while IFS= read -r lane; do run_lane "$lane"; done <<< "$lane_names"
node "$plan/verify-receipts.cjs" "$out"
