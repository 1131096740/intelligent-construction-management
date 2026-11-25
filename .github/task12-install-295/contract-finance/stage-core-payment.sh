#!/bin/bash
set -euo pipefail

[[ $# == 3 ]] || exit 64
workspace=$1
work=$2
mode=$3
plan=$(cd "$(dirname "$0")" && pwd -P)
tests=(
  services/api/src/database/contract-business-entry-http.spec.ts
  services/api/src/database/company-transfer-http-postgres.spec.ts
  services/api/src/database/payment-execution-concurrency.spec.ts
)
mkdir -p "$work"
for relative in "${tests[@]}"; do
  mkdir -p "$work/${relative%/*}"
  cp "$workspace/$relative" "$work/$relative"
done
case "$mode" in
  current-320|text-direct-330)
    gzip -dc "$plan/core-payment-tests-current329.patch.gz" | patch --batch --forward --fuzz=0 --silent -p1 -d "$work"
    if [[ $mode == text-direct-330 ]]; then
      payment=payment-concurrency-330.patch
    else
      payment=payment-concurrency-320.patch
    fi
    patch --batch --forward --fuzz=0 --silent -p1 -d "$work" < "$plan/$payment"
    ;;
  legacy)
    gzip -dc "$plan/core-payment-tests.patch.gz" | patch --batch --forward --fuzz=0 --silent -p1 -d "$work"
    ;;
  *) exit 64 ;;
esac
for relative in "${tests[@]}"; do chmod 0644 "$work/$relative"; done

if [[ $mode == text-direct-330 ]]; then
  node - "$workspace" "$work" "$plan/core-payment-330-fixtures.json" <<'JS'
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const path=require('node:path');
const [workspace,overlays,manifest]=process.argv.slice(2);
const plan=path.dirname(manifest);
const {materials,fixtures}=require(manifest);
const checksum=(root,relative)=>createHash('sha256').update(readFileSync(path.join(root,relative))).digest('hex');
for (const [relative,expected] of Object.entries(materials)) assert.equal(checksum(plan,relative),expected,'CORE_PAYMENT_330_PATCH');
for (const [relative,{input,output}] of Object.entries(fixtures)) {
  assert.equal(checksum(workspace,relative),input,'CORE_PAYMENT_330_PREIMAGE');
  assert.equal(checksum(overlays,relative),output,'CORE_PAYMENT_330_POSTIMAGE');
}
JS
fi
