#!/bin/bash
set -euo pipefail
mode=${1:-install}
[[ $# -le 1 ]]
case "$mode" in install|settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|pol275|pfq|remaining-direct-capacity|remaining-project-funding|remaining-generic|remaining-generic-batch|remaining-operating-ledger|remaining-pol215|remaining-affiliate-subject|remaining-business-definition|remaining-fund-movement|remaining-takeover-correction|remaining-participant-history|remaining-payable-settlement|remaining-takeover-task1|remaining-file-binding-manifest|remaining-spot-material|remaining-cleanup|remaining-profile|remaining-wage) ;; *) exit 2 ;; esac
if [[ $mode == remaining-generic ]]; then
  for lane in generic-batch operating-ledger pol215 affiliate-subject business-definition; do
    bash "$0" "remaining-$lane"
  done
  exit 0
fi
root=$(git rev-parse --show-toplevel)
input="$root/.github/task12-install-289"
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-task12-289.XXXXXXXX")
mkdir -m 0755 "$temp/product"
python3 "$input/produce.py" "$root" "$CI_SOURCE_SHA" "$input/historical-install-inputs.tar.gz" "$input/installer.cjs" "$temp/admission"
(umask 022; node "$input/checkout.cjs" --materialize-289 "$root" "$temp/product")
node "$input/verify.cjs" "$temp/product"
mkdir "$temp/context"
cp -R "$temp/admission/source" "$temp/context/"
cp "$temp/admission"/{source-seal.txt,source-admission.json} "$temp/context/"
cp "$input"/{Dockerfile,checkout.cjs,installer.cjs,exact-source.json,install-only.cjs} "$temp/context/"
entry=install-only.cjs
entry_args=()
fixture_pids=256
fixture_tmpfs=512m
fixture_mounts=()
if [[ $mode == pfq ]]; then
  mkdir "$temp/context/workspace"
  bash "$input/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement
  cp "$input/contract-ci.cjs" "$temp/context/"
  cat "$input/settlement.Dockerfile" >> "$temp/context/Dockerfile"
elif [[ $mode == pol275 ]]; then
  bash "$input/pol275/workspaces.sh" "$root" "$CI_SOURCE_SHA" "$temp/context"
  cp "$input/pol275/base-pol275.cjs" "$temp/context/pol275.cjs"
  cat "$input/pol275/Dockerfile" >> "$temp/context/Dockerfile"
elif [[ $mode == pol109 ]]; then
  mkdir "$temp/context/workspace"
  bash "$input/pol109-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace"
  cp "$input/pol109-installer.cjs" "$temp/context/installer.cjs"
  cp "$input/pol109-workspace-proof.cjs" "$temp/context/workspace-proof.cjs"
  cp "$input/pol109-workspace-inputs.json" "$temp/context/workspace-inputs.json"
  cp "$input/pol109-entry.cjs" "$temp/context/"
  cat "$input/pol109.Dockerfile" >> "$temp/context/Dockerfile"
  printf '%s\n' 'COPY --chmod=644 pol109-entry.cjs /qualification/' >> "$temp/context/Dockerfile"
  entry=pol109-entry.cjs
elif [[ $mode == remaining-direct-capacity ]]; then
  node "$root/services/api/prisma/remaining-dynamic-289-preflight.cjs" --preflight "$root" > "$temp/remaining-preflight.json"
  mkdir "$temp/context/workspace"
  bash "$input/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement
  cp "$input/fresh-installer.cjs" "$temp/context/installer.cjs"
  cp "$input/remaining-direct-capacity.cjs" "$temp/context/"
  cat "$input/settlement.Dockerfile" >> "$temp/context/Dockerfile"
  printf '%s\n' 'COPY --chmod=644 remaining-direct-capacity.cjs /qualification/' >> "$temp/context/Dockerfile"
  fixture="$input/fixtures/direct-payment-capacity-concurrency.spec.ts"
  printf '%s  %s\n' '735b7c13cafc6a54930d9c6d862fb0fe4d04467329cc5f7fce83436ca0612f31' "$fixture" | sha256sum --check --status
  fixture_mounts+=(--mount "type=bind,src=$fixture,dst=/qualification/workspace/services/api/src/database/direct-payment-capacity-concurrency.spec.ts,readonly")
  entry=remaining-direct-capacity.cjs
elif [[ $mode == remaining-cleanup || $mode == remaining-profile || $mode == remaining-wage ]]; then
  node "$root/services/api/prisma/remaining-dynamic-289-preflight.cjs" --preflight "$root" > "$temp/remaining-preflight.json"
  mkdir "$temp/context/workspace"
  bash "$input/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement
  lane="${mode#remaining-}"
  python3 "$input/remaining-special.py" "$lane" "$temp/context/installer.cjs" > "$temp/remaining-mounts.tsv"
  while IFS=$'\t' read -r source target; do
    fixture_mounts+=(--mount "type=bind,src=$source,dst=/qualification/$target,readonly")
  done < "$temp/remaining-mounts.tsv"
  cat "$input/settlement.Dockerfile" >> "$temp/context/Dockerfile"
  entry=entry.cjs
  if [[ $lane != wage ]]; then entry_args=("$lane"); fi
elif [[ $mode == remaining-* ]]; then
  node "$root/services/api/prisma/remaining-dynamic-289-preflight.cjs" --preflight "$root" > "$temp/remaining-preflight.json"
  mkdir "$temp/context/workspace"
  bash "$input/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" settlement
  cp "$input/fresh-installer.cjs" "$temp/context/installer.cjs"
  cp "$input"/{remaining-owner.cjs,remaining-owner-modes.json} "$temp/context/"
  cat "$input/settlement.Dockerfile" >> "$temp/context/Dockerfile"
  printf '%s\n' 'COPY --chmod=644 remaining-owner.cjs remaining-owner-modes.json /qualification/' >> "$temp/context/Dockerfile"
  entry=remaining-owner.cjs
  entry_args=("${mode#remaining-}")
  node "$input/remaining-owner.cjs" --mounts "${entry_args[0]}" "$temp/product" > "$temp/remaining-mounts.tsv"
  while IFS=$'\t' read -r source target; do
    fixture_mounts+=(--mount "type=bind,src=$source,dst=/qualification/workspace/services/api/$target,readonly")
  done < "$temp/remaining-mounts.tsv"
elif [[ $mode != install ]]; then
  mkdir "$temp/context/workspace"
  bash "$input/settlement-workspace.sh" "$root" "$CI_SOURCE_SHA" "$temp/context/workspace" "$mode"
  case "$mode" in
    v7|invoice|pol279)
      cp "$input/fresh-installer.cjs" "$temp/context/installer.cjs"
      cp "$input/fresh-owner289.cjs" "$temp/context/"
      entry=fresh-entry.cjs
      entry_args=("$mode")
      printf '%s\n' 'COPY --chmod=644 fresh-owner289.cjs /qualification/' >> "$temp/context/Dockerfile"
      ;;
    pol108-core|pol108-facts|pol108-impacts)
      cp "$input/pol108-installer.cjs" "$temp/context/installer.cjs"
      cp "$input"/{pol108-289.cjs,pol108-observability.cjs,pol108-shards.cjs} "$temp/context/"
      entry=pol108-entry.cjs
      entry_args=("${mode#pol108-}")
      fixture_pids=128
      case "$mode" in
        pol108-facts) fixture_tmpfs=1g ;;
        pol108-impacts) fixture_tmpfs=2g ;;
      esac
      printf '%s\n' 'COPY --chmod=644 pol108-289.cjs pol108-observability.cjs pol108-shards.cjs /qualification/' >> "$temp/context/Dockerfile"
      ;;
    pol280)
      cp "$input/pol280-installer.cjs" "$temp/context/installer.cjs"
      cp "$input/pol280.cjs" "$temp/context/"
      entry=pol280-entry.cjs
      printf '%s\n' 'COPY --chmod=644 pol280.cjs /qualification/' >> "$temp/context/Dockerfile"
      ;;
    *)
      cp "$input/settlement-installer.cjs" "$temp/context/installer.cjs"
      entry="$mode-entry.cjs"
      ;;
  esac
  cp "$input/contract-ci.cjs" "$input/$entry" "$temp/context/"
  cat "$input/settlement.Dockerfile" >> "$temp/context/Dockerfile"
  printf 'COPY --chmod=644 %s /qualification/\n' "$entry" >> "$temp/context/Dockerfile"
fi
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/context"
image=$(cat "$temp/image.id")
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
if [[ $mode == pfq ]]; then
  exec bash "$input/pfq/run-lanes.sh" "$image" "$temp/product"
elif [[ $mode == pol275 ]]; then
  exec bash "$input/pol275/run-lanes.sh" "$image" "$temp/product"
fi
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit "$fixture_pids" --memory 4g --user postgres --init \
  --tmpfs "/tmp:rw,noexec,nosuid,size=$fixture_tmpfs" \
  --mount "type=bind,src=$temp/product,dst=/qualification/product,readonly" \
  ${fixture_mounts[@]+"${fixture_mounts[@]}"} \
  --entrypoint node "$image" "/qualification/$entry" ${entry_args[@]+"${entry_args[@]}"}
