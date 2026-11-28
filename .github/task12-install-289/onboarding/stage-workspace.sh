#!/bin/bash
set -euo pipefail
bundle=$(cd "$(dirname "$0")" && pwd -P)
root=$1
lane=$2
workspace=$3
[[ -d "$workspace" && -z $(ls -A "$workspace") ]]
case "$lane" in lifecycle-rest|lifecycle-desktop|lifecycle-mobile|downstream|roster) ;; *) exit 2 ;; esac
node "$bundle/workspace-admission.cjs" --preflight "$root"
tree=$(node -p "require(process.argv[1]).tree" "$bundle/application-source.json")
git -C "$root" archive "$tree" --   package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/pnpm-workspace.mjs   packages/shared-domain apps/web-admin services/api | tar xf - -C "$workspace"
for file in "$bundle/material/$lane/"*.ts; do
  name=${file##*/}
  case "$name" in
    roster.spec.ts)
      install -m 644 "$file" "$workspace/services/api/src/database/project-roster-http-postgres.owned282.spec.ts" ;;
    *.owned282.spec.ts)
      install -m 644 "$file" "$workspace/services/api/src/database/$name" ;;
    *.e2e.ts)
      install -m 644 "$file" "$workspace/apps/web-admin/e2e/$name" ;;
    *) exit 2 ;;
  esac
done
for file in organization.service.ts organization.service.spec.ts; do
  relative=services/api/src/organization/$file
  cmp "$workspace/$relative" "$bundle/product/$relative"
done
