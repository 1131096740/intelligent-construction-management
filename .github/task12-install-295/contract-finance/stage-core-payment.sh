#!/bin/bash
set -euo pipefail

[[ $# == 3 ]] || exit 64
workspace=$1
work=$2
mode=$3
precision=$mode
exact346=false
if [[ $mode == expense-witness-34[69] || $mode == signed-settlement-350 || $mode == company-history-352 ]]; then
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
  if [[ $precision == expense-witness-349 || $precision == signed-settlement-350 || $precision == company-history-352 ]]; then
    (cd "$fixtures" && git apply -p0 --include=contract-finance-owned.test-support.ts "$plan/payment-execution-349-fixtures.patch")
    [[ $(sha256sum "$fixtures/contract-finance-owned.test-support.ts" | cut -d' ' -f1) == fc17a8068503366316ef5cba8c86e376d2b8ddb88dd5cf82237e80d2b9229e39 ]] || exit 65
  fi
  if [[ $precision == signed-settlement-350 || $precision == company-history-352 ]]; then
    git -C "$fixtures" apply -p0 "$plan/core-payment-350-ledger.patch"
    [[ $(sha256sum "$fixtures/contract-finance-owned.test-support.ts" | cut -d' ' -f1) == 87bb2cae10d3cb927c5e2f32c624f57c53e992949bf8ea7efe357cd989c28e7e ]] || exit 65
  fi
  if [[ $precision == company-history-352 ]]; then
    (cd "$fixtures" && git apply -p0 --include=contract-finance-owned.test-support.ts "$plan/payment-execution-352-fixtures.patch")
    [[ $(sha256sum "$fixtures/contract-finance-owned.test-support.ts" | cut -d' ' -f1) == d12ddb8a4d8a898f5f33f6e166e1b7fbdc6884ebde4a0a153e0dacd6819c515c ]] || exit 65
  fi
  chmod 0644 "$fixtures/contract-finance-owned.test-support.ts"
fi

# Retired HTTP entry must stay closed. Keep the downstream historical quota
# review, PDF and allocation witnesses with an isolated historical fixture.
case "$precision" in
  expense-witness-349|signed-settlement-350|company-history-352)
    guard="$workspace/services/api/src/retired-write-entry/retired-write-entry.guard.ts"
    retired='  { controller: "ProjectController", handler: "requestProjectFinancingQuota" },'
    if grep -Fxq "$retired" "$guard"; then
      fixture="$fixtures/contract-business-entry-http.spec.ts"
      [[ $(sha256sum "$fixture" | cut -d' ' -f1) == bb8aa70d87355bd4c7c1a7d016a1caea5267980d6bf8ddec57c185175a67dbfc ]] || exit 65
      patch --batch --forward --fuzz=0 --silent -p0 -d "$fixtures" < "$plan/core-payment-fnd05-history.patch"
      [[ $(sha256sum "$fixture" | cut -d' ' -f1) == 4661e269520c6c3eb72c16208434127f92102eb03d2a68a203c398c7e3ae0f8a ]] || exit 65
    fi
    ;;
esac
