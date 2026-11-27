#!/bin/bash
set -euo pipefail
umask 077

[[ $# == 4 || $# == 5 || ( $# == 6 && ( $5 == ledger-loss-346 || $5 == competition-346 || $5 == standard-346 || $5 == text-direct-346 || $5 == standard-349 || $5 == text-direct-349 ) && $6 == --host-only ) ]] || exit 64
variant=${5-}
case "$variant" in
  ''|standard-330|standard-331|standard-332|standard-334|standard-346|text-direct-346|standard-349|text-direct-349|ledger-loss-330|ledger-loss-331|ledger-loss-332|ledger-loss-346|competition-331|competition-332|competition-346) ;;
  *) exit 64 ;;
esac
[[ $# == 4 || -n $variant ]] || exit 64
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
build=$(cd "$4" && pwd -P)
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 65
plan=$(cd "$(dirname "$0")" && pwd -P)
common="$plan/common"
scope=task398-standard

count=$(node -e '
  const source=require(process.argv[1]);
  const count=source.mode==="expense-witness-349"?349:source.mode==="expense-witness-346"?346:source.mode==="historical-settlement-334"?334:source.mode==="upward-archive-332"?332:source.mode==="payment-remainder-331"?331:source.mode==="text-direct-330"?330:source.mode==="current-320"?329:295;
  if(source.sourceSha!==process.argv[2]||source.migrationCount!==count)process.exit(1);
  if(count===332)require(process.argv[3]).assertSource(source,process.argv[2],require(process.argv[4]).final);
  if(count===334) require(process.argv[5]).assertSource(source,require(process.argv[4]).final);
  if(count>=346) require(process.argv[6]+"/expense-witness-"+count+"-profile.cjs").assertSource(source,require(process.argv[4]).final);
  console.log(count);
' "$prepared/source.json" "$sha" "$plan/upward-archive-332-profile.cjs" "$common/multi-witness.cjs" "$plan/historical-settlement-334-profile.cjs" "$plan")
if [[ $count == 346 && $variant != ledger-loss-346 && $variant != competition-346 && $variant != standard-346 && $variant != text-direct-346 ]]; then exit 64; fi
if [[ $count == 349 && $variant != standard-349 && $variant != text-direct-349 ]]; then exit 64; fi
if [[ $count == 334 && -n $variant && $variant != standard-334 ]]; then exit 64; fi
variant_args=()
purpose=TASK398_STANDARD_EXACT_$count
if [[ -n $variant ]]; then
  [[ ${variant##*-} == "$count" ]] || exit 64
  variant_args=("$variant")
fi
case "$variant" in
  ledger-loss-*) purpose=TASK398_LEDGER_LOSS_EXACT_$count ;;
  competition-*) purpose=TASK398_COMPETITION_EXACT_$count ;;
  text-direct-346|text-direct-349) purpose=TASK425_TEXT_DIRECT_FINANCE_$count ;;
  '') if (( count >= 330 )); then purpose=TASK425_TEXT_DIRECT_FINANCE_$count; fi ;;
esac
if [[ $variant == standard-346 || $variant == text-direct-346 || $variant == standard-349 || $variant == text-direct-349 ]]; then
  [[ $plan == "$repo/.github/task12-install-295/contract-finance" && $(git -C "$repo" rev-parse HEAD) == "$sha" ]] || exit 65
  [[ -z $(git -C "$repo" status --porcelain --untracked-files=all -- "$plan" "$repo/.github/task12-install-290/standard/fixtures") ]] || exit 65
  cmp -s "$prepared/source.json" <(node "$plan/check-ledger.cjs" "$repo" "$sha" "--expense-witness-$count") || exit 65
  node - "$plan/expense-witness-$count-profile.cjs" "$prepared/prepared/context/workspace" <<'JS'
const [profile,workspace]=process.argv.slice(2);
require(profile).assertRuntimeBaseline(
  require(workspace+'/services/api/prisma/migration-baseline.cjs'));
JS
fi
if [[ ${6:-} != --host-only ]]; then
  image=$(cat "$build/image.id")
  fingerprint=$(cat "$build/context.sha256")
  [[ $image =~ ^sha256:[a-f0-9]{64}$ && $fingerprint =~ ^[a-f0-9]{64}$ ]] || exit 65
  [[ $(node "$plan/context-sha.cjs" "$prepared/prepared/context" "$build/Dockerfile" "$prepared/source.json") == "$fingerprint" ]] || exit 65
  [[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.contract-finance.source-sha"}} {{index .Config.Labels "org.jiangkong.contract-finance.context-sha256"}}') == "$image linux/amd64 $sha $fingerprint" ]] || exit 65
fi

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-finance-$scope.XXXXXXXX")
python3 "$plan/stage-task398-standard.py" \
  "$repo/.github/task12-install-290/standard/fixtures" "$prepared/prepared/context/workspace" "$work" > "$work/overlay-files.txt"
overlay_files=()
while IFS= read -r file; do overlay_files+=("$file"); done < "$work/overlay-files.txt"
[[ ${#overlay_files[@]} == 6 ]] || exit 65
if (( count >= 329 )); then
  patch --batch --forward --fuzz=0 --silent "$work/services/api/prisma/run-task398-shared-standard-local.cjs" < "$plan/task398-standard-320.patch"
fi
if (( count >= 330 )); then
  runner="$work/services/api/prisma/run-task398-shared-standard-local.cjs"
  runner_sha() { node -e 'const fs=require("node:fs"),{createHash}=require("node:crypto"); console.log(createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$runner"; }
  [[ $(runner_sha) == 08bacc09e2870c23bc4e73ff5d6473ae1a64c005d3ed92790713609406369b96 ]] || exit 65
  patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-text-direct-330.patch"
  [[ $(runner_sha) == 2a38871242e820e1164c3a68ca1373795dc05adf14a147500ec981e06a403b97 ]] || exit 65
  if [[ $variant == ledger-loss-* ]]; then
    spec="$work/services/api/src/database/task16-shared-standard.http.pg.spec.ts"
    [[ $(sha256sum "$spec" | cut -d' ' -f1) == e70aa4d7364f7232f694881bb96fce88bfa57a89bd24fc6f527b4d85dfa6b901 ]] || exit 65
    patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-commit-fault-330.patch"
    [[ $(sha256sum "$spec" | cut -d' ' -f1) == 4f374450ef008d745d67807529521d36b1d6a598a60dc5b161804b626b183b78 ]] || exit 65
    patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-ledger-loss-330.patch"
    [[ $(runner_sha) == d21d72c39d6a3baead9ff149607b4cdac607b13ce0c810508997f44c3278c50d ]] || exit 65
    if (( count >= 331 )); then
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-ledger-loss-331.patch"
      [[ $(runner_sha) == af42b4c2fb8489cd6560b8dfb2775f4880ed806730e9e00d36073ebd1bb89b29 ]] || exit 65
    fi
    if [[ $count == 332 || $count == 346 ]]; then
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-ledger-loss-332.patch"
      [[ $(runner_sha) == f999f4eeeecee567a8391c5aa9d46e9102648bb285d6e849af720491c38878db ]] || exit 65
    fi
    if [[ $count == 346 ]]; then
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-ledger-loss-346.patch"
      [[ $(runner_sha) == 2987bc05d395030c264c4a55def4e6b0e771e851dac47c13935fded0648d9ce2 ]] || exit 65
    fi
  elif (( count >= 331 )); then
    patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-standard-331.patch"
    [[ $(runner_sha) == a53edcb4f8dd60c88ee74f784d9eb1e5d04296e2c024a74680f1f38f84e92f33 ]] || exit 65
    if [[ $variant == competition-* ]]; then
      spec="$work/services/api/src/database/task16-shared-standard.http.pg.spec.ts"
      [[ $(sha256sum "$spec" | cut -d' ' -f1) == e70aa4d7364f7232f694881bb96fce88bfa57a89bd24fc6f527b4d85dfa6b901 ]] || exit 65
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-competition-runner-331.patch"
      patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-competition-spec-331.patch"
      [[ $(runner_sha) == e5bc00fab58ecac6786b9bc6a8228f6af3906c8a093bedea2a052bcd9a02973b ]] || exit 65
      [[ $(sha256sum "$spec" | cut -d' ' -f1) == 05bfdec5b4e12815b6ca7c3ea9345d44b4c27ab77a52223f62ccbda18187ad1c ]] || exit 65
      if [[ $count == 332 || $count == 346 ]]; then
        patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-competition-runner-332.patch"
        [[ $(runner_sha) == 75de360063ce1d7a60abacaf015e2718aab99fc871995bea9e127fe6adeba924 ]] || exit 65
      fi
      if [[ $count == 346 ]]; then
        patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-competition-runner-346.patch"
        [[ $(runner_sha) == 4838c88e40550af557caadd31cb1d4a6c6b3ab83fa306bc551dec5a7687c2193 ]] || exit 65
      fi
    elif (( count >= 332 )); then
      patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-standard-332.patch"
      [[ $(runner_sha) == c6a839367ad8896d95e464a6da9499788338d347f02f21fc76f81bf7500487fc ]] || exit 65
      if (( count >= 334 )); then
        patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-standard-334.patch"
        [[ $(runner_sha) == ca49599d0ff11ab106f211195d3f5c485ce4259d145c538e6c1c38f832535f68 ]] || exit 65
      fi
      if (( count >= 346 )); then
        patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-standard-346.patch"
        [[ $(runner_sha) == fbbe5c4b574daabf90e17ec2cca84f9c0083aaebf5b0dbccb7dc5275e0110a05 ]] || exit 65
      fi
      if (( count == 349 )); then
        patch --batch --forward --fuzz=0 --silent "$runner" < "$plan/task398-standard-349.patch"
        [[ $(runner_sha) == 41dc4108437b6c6a8f929f4366435e3d103d9ad2193569cada9dc231d2406b51 ]] || exit 65
      fi
      if [[ -z $variant || $variant == text-direct-346 || $variant == text-direct-349 ]]; then
        relative=services/api/src/database/task16-text-agreement-payments.http.pg.spec.ts
        spec="$work/$relative"
        cp "$prepared/prepared/context/workspace/$relative" "$spec"
        [[ $(sha256sum "$spec" | cut -d' ' -f1) == a23a5009503b6683aa545c582ff0e511c85768e417d591555d502a1934686b49 ]] || exit 65
        patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-text-direct-spec-332.patch"
        [[ $(sha256sum "$spec" | cut -d' ' -f1) == a019456b916800c5f9d8356b014182aedfdead1d7e93252a745841d8223b274a ]] || exit 65
        if (( count >= 334 )); then
          patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-text-direct-spec-334.patch"
          [[ $(sha256sum "$spec" | cut -d' ' -f1) == d27353b766c05c16fd1e55d139646902188184e5998cab9a3e9e73f77c6cb6d2 ]] || exit 65
        fi
        if (( count >= 346 )); then
          patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-text-direct-spec-346.patch"
          [[ $(sha256sum "$spec" | cut -d' ' -f1) == 7756d9190db9096eca879a059d766695239b93b8b07a1bf067712a3d61477163 ]] || exit 65
        fi
        if (( count == 349 )); then
          patch --batch --forward --fuzz=0 --silent "$spec" < "$plan/task398-text-direct-spec-349.patch"
          [[ $(sha256sum "$spec" | cut -d' ' -f1) == 957c9e93b5a79fd680bb31eb269ce00ff01ef824b414bba6f436ee83935ba347 ]] || exit 65
        fi
        chmod 0644 "$spec"
        overlay_files+=("$relative")
      fi
    fi
  fi
fi

args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1024m --env HOME=/tmp --env PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product289,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/context/successor.sql,dst=/qualification/successor.sql,readonly"
  --mount "type=bind,src=$prepared/source.json,dst=/qualification/contract-finance-source.json,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003600_fund_balance_notice_lock/migration.sql,dst=/qualification/terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003700_company_transfer_ordinary_loan_payout_checkpoints/migration.sql,dst=/qualification/payout-terminal.sql,readonly"
  --mount "type=bind,src=$prepared/tails/20261119003800_company_transfer_ordinary_loan_multi_witness/migration.sql,dst=/qualification/multi-witness.sql,readonly"
  --mount "type=bind,src=$plan/task398-standard-entry.cjs,dst=/qualification/task398-standard-entry.cjs,readonly"
  --mount "type=bind,src=$plan/upward-archive-332-profile.cjs,dst=/qualification/upward-archive-332-profile.cjs,readonly")
installer="$common/installer.cjs"
if (( count >= 334 )); then
  node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
  installer="$work/installer.cjs"
  if (( count >= 346 )); then
    git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer.patch"
    expected_installer=$(node -p 'require(process.argv[1]).installerSha256' "$plan/expense-witness-346-profile.cjs")
    [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected_installer" ]] || exit 65
    if (( count == 349 )); then
      git -C "$work" apply --unidiff-zero "$plan/expense-witness/installer-349.patch"
      expected_installer=$(node -p 'require(process.argv[1]).installerSha256' "$plan/expense-witness-349-profile.cjs")
      [[ $(sha256sum "$installer" | cut -d' ' -f1) == "$expected_installer" ]] || exit 65
      for file in expense-witness-349-profile.cjs payment-execution-349.cjs; do
        args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
      done
    fi
    chmod 0644 "$installer"
    if [[ ${6:-} == --host-only ]]; then
      if [[ $variant == standard-346 || $variant == text-direct-346 || $variant == standard-349 || $variant == text-direct-349 ]]; then
        node --check "$runner"
        node --check "$installer"
        node --check "$plan/task398-standard-entry.cjs"
        printf '%s_HOST_READY sha=%s material=%s\n' "$purpose" "$sha" "$work"
        exit 0
      fi
      printf '%s\n' "$work"
      exit 0
    fi
    printf '%s\n' "$work"
    for file in expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
      args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
    done
  fi
  for file in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
    args+=(--mount "type=bind,src=$plan/$file,dst=/qualification/$file,readonly")
  done
fi
args+=(--mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
for file in install-only292.cjs checkout.cjs successor.cjs scope.json tree-proof.json   terminal.cjs terminal.json payout-terminal.cjs multi-witness.cjs multi-witness-diagnostic.cjs owner-observation.cjs; do
  args+=(--mount "type=bind,src=$common/$file,dst=/qualification/$file,readonly")
done
for file in "${overlay_files[@]}"; do
  args+=(--mount "type=bind,src=$work/$file,dst=/qualification/workspace/$file,readonly")
done

[[ -z $(docker ps -q) ]] || exit 65
if pgrep -x postgres >/dev/null; then exit 65; fi
exit_code=0
docker run "${args[@]}" --entrypoint node "$image" /qualification/task398-standard-entry.cjs ${variant_args[@]+"${variant_args[@]}"} > "$work/private.stdout" 2> "$work/private.stderr" || exit_code=$?
tail -n 1 "$work/private.stdout" > "$work/receipt.json"
node -e '
  const row=require(process.argv[1]);
  const purpose=process.argv[3];
  if(row.purpose!==purpose||row.sourceSha!==process.argv[2])process.exit(1);
  console.log(JSON.stringify(row));
' "$work/receipt.json" "$sha" "$purpose" || { printf 'TASK398_STANDARD_295_NO_RECEIPT %s\n' "$work" >&2; exit 1; }
(( exit_code == 0 )) || exit "$exit_code"
node -e '
  const proof=require(process.argv[1]);
  const expected=process.argv[3]+"_PASSED";
  if(proof.status!==expected||proof.sourceSha!==process.argv[2])process.exit(1);
' "$work/receipt.json" "$sha" "$purpose"
