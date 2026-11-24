#!/bin/bash
set -euo pipefail
umask 022

[[ $# == 4 ]] || exit 64
prepared=$(cd "$1" && pwd -P)
sha=$2
profile=$3
destination=$4
target=contract-finance-api
case "$profile" in
  api) tools_profile=deps ;;
  browser) tools_profile=browser-tools ;;
  mobile) tools_profile=mobile-tools ;;
  restore) tools_profile=browser-tools; target=contract-finance-restore ;;
  *) exit 64 ;;
esac
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
context="$prepared/prepared/context"
[[ -f "$context/Dockerfile" && -f "$context/workspace/pnpm-lock.yaml" ]] || exit 65
node -e 'if (require(process.argv[1]).sourceSha!==process.argv[2]) process.exit(1)' "$prepared/source.json" "$sha"
mkdir "$destination"
destination=$(cd "$destination" && pwd -P)

# Reuse both pinned parent images and every historical loader instruction.
awk '
  BEGIN {print "ARG JG_CONTRACT_FINANCE_TOOLS=deps"}
  /^FROM postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d$/ {
    print $0 " AS contract-finance-loader"
    count++
    next
  }
  {print}
  END {if (count != 1) exit 1}
' "$context/Dockerfile" > "$destination/Dockerfile"
cat "$plan/workspace.Dockerfile" >> "$destination/Dockerfile"

# Label the exact materialized source tree and transport recipe independently of Docker's local image ID.
context_sha=$(node "$plan/context-sha.cjs" "$context" "$destination/Dockerfile" "$prepared/source.json")
printf '%s\n' "$context_sha" > "$destination/context.sha256"
docker build --platform linux/amd64 --target "$target" \
  --file "$destination/Dockerfile" --iidfile "$destination/image.id" \
  --build-arg "JG_CONTRACT_FINANCE_TOOLS=$tools_profile" \
  --label "org.jiangkong.contract-finance.source-sha=$sha" \
  --label "org.jiangkong.contract-finance.context-sha256=$context_sha" \
  --label "org.jiangkong.local-run=${JG_QUALIFICATION_LOCAL_RUN:-}" "$context"
image=$(cat "$destination/image.id")
[[ $image =~ ^sha256:[a-f0-9]{64}$ ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $context_sha" ]]
