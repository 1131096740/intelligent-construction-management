#!/bin/bash
set -euo pipefail

[[ $# == 2 && $1 =~ ^[a-f0-9]{40}$ && $2 == pol113_pol114 ]] || exit 64
export CI_SOURCE_SHA=$1
plan=$(cd "$(dirname "$0")" && pwd -P)
bash "$plan/ci.sh" pol113 --historical-settlement-334
bash "$plan/ci.sh" pol114 --historical-settlement-334
