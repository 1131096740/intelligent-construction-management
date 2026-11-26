#!/bin/bash
set -euo pipefail
[[ $# == 2 && ( $2 == cold || $2 == warm ) ]] || exit 64
work=$1
lane=$2
plan=$(cd "$(dirname "$0")" && pwd -P)
base=$(cd "$plan/.." && pwd -P)
node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
git -C "$work" apply --unidiff-zero "$base/expense-witness/installer.patch"
canonical=$(node -p 'require(process.argv[1]).installerSha256' "$base/expense-witness-346-profile.cjs")
[[ $(shasum -a 256 "$work/installer.cjs" | cut -d ' ' -f1) == "$canonical" ]] || exit 65
if [[ $lane == warm ]]; then
  git -C "$work" apply -p0 --unidiff-zero "$plan/installer-pol275.patch"
  git -C "$work" apply -p0 --unidiff-zero "$plan/installer-pol275-346.patch"
  expected=$(node -p 'require(process.argv[1]).warmInstallerSha256' "$plan/exact-346.cjs")
  [[ $(shasum -a 256 "$work/installer.cjs" | cut -d ' ' -f1) == "$expected" ]] || exit 65
fi
node --check "$work/installer.cjs"
chmod 0644 "$work/installer.cjs"
