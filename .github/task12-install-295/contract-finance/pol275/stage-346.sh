#!/bin/bash
set -euo pipefail
[[ ( $# == 2 || ( $# == 3 && ( $3 == 346 || $3 == 349 ) ) ) && ( $2 == cold || $2 == warm ) ]] || exit 64
work=$1
lane=$2
count=${3:-346}
plan=$(cd "$(dirname "$0")" && pwd -P)
base=$(cd "$plan/.." && pwd -P)
node "$base/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
git -C "$work" apply --unidiff-zero "$base/expense-witness/installer.patch"
if [[ $count == 349 ]]; then
  git -C "$work" apply --unidiff-zero "$base/expense-witness/installer-349.patch"
fi
canonical=$(node -p 'require(process.argv[1]).installerSha256' "$base/expense-witness-$count-profile.cjs")
[[ $(shasum -a 256 "$work/installer.cjs" | cut -d ' ' -f1) == "$canonical" ]] || exit 65
if [[ $lane == warm ]]; then
  git -C "$work" apply -p0 --unidiff-zero "$plan/installer-pol275.patch"
  git -C "$work" apply -p0 --unidiff-zero "$plan/installer-pol275-346.patch"
  if [[ $count == 349 ]]; then
    git -C "$work" apply -p0 --unidiff-zero "$plan/installer-pol275-349.patch"
  fi
  expected=$(node -p 'require(process.argv[1]).warmInstallerSha256' "$plan/exact-$count.cjs")
  [[ $(shasum -a 256 "$work/installer.cjs" | cut -d ' ' -f1) == "$expected" ]] || exit 65
fi
node --check "$work/installer.cjs"
chmod 0644 "$work/installer.cjs"
