#!/bin/bash
set -euo pipefail

[[ ( $# == 2 || ( $# == 3 && $3 == --expense-witness-349 ) ) && $1 =~ ^[a-f0-9]{40}$ ]] || exit 64
export CI_SOURCE_SHA=$1
mode=${3:---expense-witness-346}
plan=$(cd "$(dirname "$0")" && pwd -P)
case "$2" in pol113_pol114|pol115_workbench|all) ;; *) exit 64 ;; esac
if [[ $2 == pol113_pol114 || $2 == all ]]; then
  bash "$plan/ci.sh" pol113 "$mode"
  bash "$plan/ci.sh" pol114 "$mode"
fi
if [[ $2 == pol115_workbench || $2 == all ]]; then
  bash "$plan/../contract-finance/run-contract-adjacent-ci.sh" "$CI_SOURCE_SHA" pol115-full "$mode"
fi
