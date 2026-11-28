#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 && $4 == --host-only ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
plan=$(cd "$(dirname "$0")" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
[[ $plan == "$repo/.github/task12-install-295/contract-finance/task01-ordered" ]] || exit 65
[[ -z $(git -C "$repo" status --porcelain --untracked-files=all) ]] || exit 65
source=$(node "$plan/../check-ledger.cjs" "$repo" "$sha" --expense-witness-346)
cmp -s "$prepared/source.json" <(printf '%s\n' "$source") || exit 65

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-task01-ordered-346.XXXXXXXX")
work=$(cd "$work" && pwd -P)
node "$plan/stage.cjs" "$prepared" "$sha" "$work"
