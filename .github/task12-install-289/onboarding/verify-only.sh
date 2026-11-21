#!/bin/bash
set -euo pipefail
[[ $# == 3 && "$1" == --preflight ]]
bundle=$(cd "$(dirname "$0")" && pwd -P)
root=$2
destination=$3
for lane in lifecycle-rest lifecycle-desktop lifecycle-mobile downstream roster; do
  workspace="$destination/$lane"
  mkdir "$workspace"
  bash "$bundle/stage-workspace.sh" "$root" "$lane" "$workspace"
  node "$bundle/verify-staged-fixtures.cjs" "$lane" "$workspace"
done
