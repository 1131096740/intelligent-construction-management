#!/bin/bash
set -euo pipefail
umask 022

[[ $# == 4 ]] || exit 64
prepared=$(cd "$1" && pwd -P)
sha=$2
profile=$3
destination=$4
case "$profile" in
  api|browser|restore|mobile) ;;
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
  /^FROM postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d$/ {
    print $0 " AS contract-finance-api"
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
docker build --platform linux/amd64 --target "contract-finance-$profile" \
  --file "$destination/Dockerfile" --iidfile "$destination/image.id" \
  --build-arg "CI_SOURCE_SHA=$sha" --build-arg "CONTEXT_SHA256=$context_sha" "$context"
image=$(cat "$destination/image.id")
[[ $image =~ ^sha256:[a-f0-9]{64}$ ]] || exit 65
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $context_sha" ]]
