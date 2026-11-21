#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 1 ]] || exit 64
sha=$1
root=$(git rev-parse --show-toplevel)
plan=$(cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-finance.XXXXXXXX")

bash "$plan/prepare.sh" "$root" "$sha" "$work/source"
bash "$plan/build.sh" "$work/source" "$sha" browser "$work/browser"
bash "$plan/build.sh" "$work/source" "$sha" restore "$work/restore"
bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank
bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/restore" restore
bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core
bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" payment
