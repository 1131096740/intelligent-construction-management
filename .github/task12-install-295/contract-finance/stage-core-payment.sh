#!/bin/bash
set -euo pipefail

[[ $# == 3 ]] || exit 64
workspace=$1
work=$2
mode=$3
exact346=false
if [[ $mode == expense-witness-346 ]]; then
  exact346=true
  mode=historical-settlement-334
fi
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
  current-320|text-direct-330|payment-remainder-331|upward-archive-332|historical-settlement-334)
    gzip -dc "$plan/core-payment-tests-current329.patch.gz" | patch --batch --forward --fuzz=0 --silent -p1 -d "$work"
    if [[ $mode != current-320 ]]; then
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

if [[ $mode == text-direct-330 || $mode == payment-remainder-331 || $mode == upward-archive-332 || $mode == historical-settlement-334 ]]; then
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

if [[ $mode == payment-remainder-331 || $mode == upward-archive-332 || $mode == historical-settlement-334 ]]; then
  fixtures="$work/services/api/src/database"
  cp "$plan/contract-finance-owned.test-support.ts" "$fixtures/"
  for file in payment-execution-concurrency.spec.ts contract-finance-owned.test-support.ts; do
    patch --batch --forward --fuzz=0 --silent -p0 -d "$fixtures" < "$plan/payment-execution-331-$file.patch"
  done
  chmod 0644 "$fixtures/contract-finance-owned.test-support.ts"
  node - "$plan" "$fixtures" <<'JS'
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const path=require('node:path');
const [plan,overlays]=process.argv.slice(2);
const {materials,fixtures}=require(path.join(plan,'core-payment-331-fixtures.json'));
const checksum=(root,relative)=>createHash('sha256').update(readFileSync(path.join(root,relative))).digest('hex');
for (const [relative,expected] of Object.entries(materials)) assert.equal(checksum(plan,relative),expected,'CORE_PAYMENT_331_MATERIAL');
for (const [relative,expected] of Object.entries(fixtures)) assert.equal(checksum(overlays,relative),expected,'CORE_PAYMENT_331_POSTIMAGE');
JS
fi

if [[ $mode == upward-archive-332 || $mode == historical-settlement-334 ]]; then
  fixtures="$work/services/api/src/database"
  for file in payment-execution-concurrency.spec.ts contract-finance-owned.test-support.ts; do
    patch --batch --forward --fuzz=0 --silent -p0 -d "$fixtures" < "$plan/payment-execution-332-$file.patch"
  done
  node - "$plan" "$fixtures" <<'JS'
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const path=require('node:path');
const [plan,overlays]=process.argv.slice(2);
const {materials,fixtures}=require(path.join(plan,'core-payment-332-fixtures.json'));
const checksum=(root,relative)=>createHash('sha256').update(readFileSync(path.join(root,relative))).digest('hex');
for (const [relative,expected] of Object.entries(materials)) assert.equal(checksum(plan,relative),expected,'CORE_PAYMENT_332_MATERIAL');
for (const [relative,expected] of Object.entries(fixtures)) assert.equal(checksum(overlays,relative),expected,'CORE_PAYMENT_332_POSTIMAGE');
JS
fi


if [[ $mode == historical-settlement-334 ]]; then
  fixtures="$work/services/api/src/database"
  for file in payment-execution-concurrency.spec.ts contract-finance-owned.test-support.ts; do
    patch --batch --forward --fuzz=0 --silent -p0 -d "$fixtures" < "$plan/payment-execution-334-$file.patch"
  done
  node - "$plan" "$fixtures" <<'JS'
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const path=require('node:path');
const [plan,overlays]=process.argv.slice(2);
const {materials,fixtures}=require(path.join(plan,'core-payment-334-fixtures.json'));
const checksum=(root,relative)=>createHash('sha256').update(readFileSync(path.join(root,relative))).digest('hex');
for (const [relative,expected] of Object.entries(materials)) assert.equal(checksum(plan,relative),expected,'CORE_PAYMENT_334_MATERIAL');
for (const [relative,expected] of Object.entries(fixtures)) assert.equal(checksum(overlays,relative),expected,'CORE_PAYMENT_334_POSTIMAGE');
JS
fi

if [[ $exact346 == true ]]; then
  # Reuse the reviewed 346 ledger guard while preserving the original Core suites.
  (cd "$fixtures" && git apply -p0 --include=contract-finance-owned.test-support.ts "$plan/payment-execution-346-fixtures.patch")
  node - "$fixtures/contract-finance-owned.test-support.ts" <<'JS'
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
assert.equal(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex'),
  'e2afc9fe3da2262eee0c2cb3d13c113eff125c24fda9f959eb09949639ffa8ff','CORE_346_LEDGER_FIXTURE');
JS
  chmod 0644 "$fixtures/contract-finance-owned.test-support.ts"
fi
