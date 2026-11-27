#!/bin/bash
set -euo pipefail
umask 077

plan=$(cd "$(dirname "$0")" && pwd -P)
issue_lane=false
signed_350=false
company_352=false
signed_issue_ordered=false
if [[ ${3-} == --signed-settlement-350 ]]; then
  [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64
  if [[ $2 == pol275 ]]; then
    [[ ( $# == 4 || ( $# == 5 && $5 == --host-only ) ) &&
      $4 == a187dc73a133114e1cfbbc891a4aec923abe2545 ]] || exit 64
  else
    [[ $# == 3 || ( $# == 4 && $4 == --host-only ) ]] || exit 64
  fi
  signed_350=true
  case "$2" in
    line-a|payment-execution|procurement|onboarding|settlement|template|draft|expense-execution|expense-finance|expense-receipt|v7|invoice|pol279|pol280|pol109|pol108-core|pol108-facts|pol108-impacts|cash-handover|principal-return|company-proxy|pfq|pol275) ;;
    issue417) issue_lane=true ;;
    *)
      scopes=$(node - "$plan/issue-ordered/profiles.cjs" "$2" <<'JS'
const [file,lane]=process.argv.slice(2);
const {issueOrderedScopes350,issue418OperatingScopes350}=require(file);
const groups={
  'issue-matrix-350':issueOrderedScopes350,
  'issue404_matrix_350':['issue404_350','issue426_a01_350'],
  'issue418-operating':issue418OperatingScopes350
};
const selected=Object.hasOwn(groups,lane)?groups[lane]:[lane];
if(selected.length===0 || selected.some(scope=>!issueOrderedScopes350.includes(scope))) process.exit(64);
process.stdout.write(selected.join(' '));
JS
      ) || exit 64
      read -r -a signed_issue_scopes <<< "$scopes"
      issue_lane=true
      signed_issue_ordered=true
      ;;
  esac
fi
if [[ ${3-} == --company-history-352 ]]; then
  [[ ${GITHUB_ACTIONS:-} != true ]] || exit 64
  if [[ $2 == pol275 ]]; then
    [[ ( $# == 4 || ( $# == 5 && $5 == --host-only ) ) && $4 == a187dc73a133114e1cfbbc891a4aec923abe2545 ]] || exit 64
  else
    [[ $# == 3 || ( $# == 4 && $4 == --host-only ) ]] || exit 64
  fi
  company_352=true
  if [[ $2 == issue417 ]]; then issue_lane=true; fi
  if [[ $2 != historical-takeover-a28 && $2 != browser-partial && $2 != browser-completion && $2 != task398-standard && $2 != pol115-full && $2 != pol115-workbench && $2 != pol115-original && $2 != pol115-spot && $2 != issue417 && $2 != pol275 && $2 != bank && $2 != cash-handover && $2 != principal-return && $2 != company-proxy && $2 != pfq && $2 != pol109 && $2 != pol108-core && $2 != pol108-facts && $2 != pol108-impacts && $2 != onboarding && $2 != procurement && $2 != line-a && $2 != core-payment && $2 != payment-execution && $2 != settlement && $2 != template && $2 != draft && $2 != v7 && $2 != invoice && $2 != pol279 && $2 != pol280 && $2 != expense-execution && $2 != expense-finance && $2 != expense-receipt ]]; then
    scopes=$(node - "$plan/issue-ordered/profiles.cjs" "$2" <<'JS'
const [file,lane]=process.argv.slice(2);
const {issueOrderedScopes352}=require(file);
const allowed=[...issueOrderedScopes352,'issue435_352'];
const groups={
  'issue-matrix-352':issueOrderedScopes352,
  'issue404_matrix_352':['issue404_352','issue426_a01_352'],
  'issue418-operating':issueOrderedScopes352.filter(scope=>scope.startsWith('issue418_'))
};
const selected=Object.hasOwn(groups,lane)?groups[lane]:[lane];
if(selected.length===0 || selected.some(scope=>!allowed.includes(scope))) process.exit(64);
process.stdout.write(selected.join(' '));
JS
    ) || exit 64
    read -r -a signed_issue_scopes <<< "$scopes"
    issue_lane=true
    signed_issue_ordered=true
  fi
fi
if [[ $issue_lane == false && ${2:-} == issue* ]]; then
  [[ $# == 3 ]] || exit 64
  case "$2:$3" in
    issue404_matrix_349:--expense-witness-349|issue417:--expense-witness-349|issue418-operating:--expense-witness-349) ;;
    *:--expense-witness-349)
      node -e 'const p=require(process.argv[1]).profileFor(process.argv[2]); if(p.requiredMigrationCount!==349) process.exit(65)' "$plan/issue-ordered/profiles.cjs" "$2" >/dev/null 2>&1 || exit 64 ;;
    issue403:--expense-witness-346|issue404:--expense-witness-346|issue417:--expense-witness-346|issue418-operating:--expense-witness-346) ;;
    issue400_346:--expense-witness-346|issue405_346:--expense-witness-346) ;;
    issue411_346:--expense-witness-346|issue413_346:--expense-witness-346|issue414_346:--expense-witness-346) ;;
    issue416_handover_346:--expense-witness-346|issue416_his_346:--expense-witness-346) ;;
    issue420_346:--expense-witness-346|issue422_346:--expense-witness-346) ;;
    issue421_346:--expense-witness-346|issue421b_346:--expense-witness-346) ;;
    *:--historical-settlement-334)
      node -e 'const p=require(process.argv[1]).profileFor(process.argv[2]); if(p.requiredMigrationCount) process.exit(65)' "$plan/issue-ordered/profiles.cjs" "$2" >/dev/null 2>&1 || exit 64 ;;
    *) exit 64 ;;
  esac
  issue_lane=true
fi

[[ $signed_350 == true || $company_352 == true || $# == 2 || ( $# == 3 && ( $3 == --current-320 || $3 == --text-direct-330 ) && $2 != pol275 ) ||
  ( $# == 3 && $3 == --payment-remainder-331 && $2 != pol275 ) ||
  ( $# == 3 && $3 == --historical-settlement-334 && ( $2 == settlement || $2 == template || $2 == draft ||
    $2 == task398-standard || $2 == cash-handover || $2 == principal-return ||
    $2 == expense-execution || $2 == expense-finance || $2 == expense-receipt || $2 == payment-execution ||
    $2 == v7 || $2 == invoice || $2 == pol279 || $2 == pol280 ||
    $2 == pol108-core || $2 == pol108-facts || $2 == pol108-impacts || $2 == pol109 ||
    $2 == browser-partial || $2 == browser-completion || $2 == company-proxy || $2 == pfq ) ) ||
  ( $# == 3 && $3 == --upward-archive-332 && ( $2 == line-a || $2 == pol115-workbench || $2 == onboarding || $2 == procurement || $2 == cash-handover || $2 == principal-return ||
    $2 == settlement || $2 == template || $2 == draft || $2 == v7 || $2 == invoice || $2 == pol279 || $2 == pol280 || $2 == company-proxy || $2 == expense-execution || $2 == expense-finance || $2 == expense-receipt || $2 == payment-execution ||
    $2 == pol108-core || $2 == pol108-facts || $2 == pol108-impacts || $2 == pol109 || $2 == task398-standard || $2 == task398-ledger-loss || $2 == browser-partial || $2 == browser-completion || $2 == pfq || $2 == cash-transfer || $2 == project-advance ) ) ||
  ( $# == 3 && ( $2 == historical-takeover-a28 || $2 == line-a || $2 == onboarding || $2 == procurement || $2 == pol115-workbench || $2 == pol115-full || $issue_lane == true ) && $3 == --historical-settlement-334 ) ||
  ( $# == 3 && ( $2 == line-a || $2 == onboarding || $2 == pol115-workbench || $2 == pol115-full || $2 == payment-execution ||
    $2 == task398-ledger-loss || $2 == task398-competition || $2 == historical-takeover-a28 || $2 == historical-takeover-a29 ||
    $2 == browser-partial || $2 == browser-completion || $2 == procurement ||
    $2 == settlement || $2 == template || $2 == draft || $2 == v7 || $2 == invoice || $2 == pol279 || $2 == pol280 ||
    $2 == expense-execution || $2 == expense-finance || $2 == expense-receipt || $2 == cash-handover || $2 == principal-return || $2 == company-proxy ||
    $2 == pol108-core || $2 == pol108-facts || $2 == pol108-impacts || $2 == pol109 ||
    $2 == pfq || $2 == task398-standard || $2 == cash-transfer || $2 == project-advance || $issue_lane == true ) && $3 == --expense-witness-346 ) ||
  ( $# == 3 && ( $issue_lane == true || $2 == pol115-full || $2 == pol115-workbench ||
    $2 == payment-execution || $2 == expense-execution || $2 == expense-finance || $2 == expense-receipt ||
    $2 == onboarding || $2 == procurement || $2 == task398-standard || $2 == browser-partial || $2 == browser-completion ||
    $2 == cash-handover || $2 == principal-return || $2 == company-proxy || $2 == line-a || $2 == historical-takeover-a28 || $2 == pfq || $2 == settlement || $2 == template || $2 == draft || $2 == v7 || $2 == invoice || $2 == pol279 || $2 == pol280 ||
    $2 == pol108-core || $2 == pol108-facts || $2 == pol108-impacts || $2 == pol109 ) && $3 == --expense-witness-349 ) ||
  ( $# == 4 && ( $2 == payment-execution || $2 == task398-competition || $2 == pol109 || $2 == cash-transfer || $2 == project-advance ) &&
    $3 == --expense-witness-346 && $4 == --host-only ) ||
  ( $# == 4 && $2 == pol275 && ( $3 == --historical-settlement-334 || $3 == --expense-witness-34[69] ) && $4 == a187dc73a133114e1cfbbc891a4aec923abe2545 ) ||
  ( $# == 4 && $2 == pol275 && ( $3 == --current-320 || $3 == --text-direct-330 || $3 == --payment-remainder-331 || $3 == --upward-archive-332 ) && $4 =~ ^[a-f0-9]{40}$ ) ]] || exit 64
sha=$1
lane=$2
mode_args=()
if [[ $issue_lane == true ]]; then
  mode_args=("$3")
elif (( $# >= 3 )); then
  case "$lane" in pol115-original|pol115-spot|bank|core-payment|settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|cash-handover|principal-return|payment-execution|task398-standard|task398-ledger-loss|task398-competition|expense-execution|expense-finance|expense-receipt|company-proxy|onboarding|procurement|pfq|browser-partial|browser-completion|pol115-workbench|pol115-full|pol275|line-a|cash-transfer|project-advance|historical-takeover-a28|historical-takeover-a29) mode_args=("$3") ;; *) exit 64;; esac
fi
if [[ ${3:-} == --text-direct-330 ]]; then
  case "$lane" in settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|line-a|onboarding|procurement|task398-standard|task398-ledger-loss|cash-handover|principal-return|pol115-workbench|company-proxy|payment-execution|browser-partial|browser-completion|expense-execution|expense-finance|expense-receipt|pfq|pol275) ;; *) exit 64;; esac
fi
if [[ ${3:-} == --payment-remainder-331 ]]; then
  case "$lane" in
    line-a|task398-ledger-loss|task398-standard|company-proxy|browser-partial|browser-completion|cash-handover|principal-return|payment-execution|settlement|template|draft|v7|invoice|pol279|pol280|pol108-core|pol108-facts|pol108-impacts|pol109|expense-execution|expense-finance|expense-receipt|pol115-workbench|pfq|onboarding|procurement|pol275) ;;
    *) exit 64 ;;
  esac
fi
if [[ $lane == historical-takeover-a28 && ${3:-} != --historical-settlement-334 && ${3:-} != --expense-witness-34[69] && $company_352 != true ]]; then exit 64; fi
if [[ $lane == historical-takeover-a29 && ${3:-} != --expense-witness-346 ]]; then exit 64; fi
if [[ $lane == pol115-full && ${3:-} != --historical-settlement-334 && ${3:-} != --expense-witness-346 && ${3:-} != --expense-witness-349 && ${3:-} != --company-history-352 ]]; then exit 64; fi
if [[ ( $lane == cash-transfer || $lane == project-advance ) && ${3:-} != --upward-archive-332 && ${3:-} != --expense-witness-346 ]]; then exit 64; fi
if [[ $lane == task398-ledger-loss && ${3:-} != --text-direct-330 && ${3:-} != --payment-remainder-331 && ${3:-} != --upward-archive-332 && ${3:-} != --expense-witness-346 ]]; then exit 64; fi
if [[ $lane == task398-competition && ${3:-} != --expense-witness-346 ]]; then exit 64; fi
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-contract-adjacent.XXXXXXXX")
if [[ ${4-} == --host-only || ( ( $signed_350 == true || $company_352 == true ) && $lane == pol275 && ${5-} == --host-only ) ]]; then
  bash "$plan/prepare.sh" "$root" "$sha" "$work/source" "$3"
  if [[ $signed_issue_ordered == true ]]; then
    for scope in "${signed_issue_scopes[@]}"; do
      bash "$plan/issue-ordered/run.sh" "$root" "$work/source" "$sha" "$work" "$scope" --host-only
    done
  elif [[ $company_352 == true ]]; then
    case "$lane" in
      historical-takeover-a28) bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work" --a28-continuation --host-only ;;
      browser-partial|browser-completion)
        kind=${lane#browser-}
        bash "$plan/browser-$kind/run-browser-$kind.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      task398-standard)
        for variant in standard-352 text-direct-352; do
          bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work" "$variant" --host-only
        done ;;
      pol115-full)
        for scope in pol115 spot; do
          bash "$plan/pol115/run-pol115-334.sh" "$root" "$work/source" "$sha" "$work" "$scope" --host-only
        done
        bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      pol115-workbench) bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      pol115-original|pol115-spot)
        scope=pol115; if [[ $lane == pol115-spot ]]; then scope=spot; fi
        bash "$plan/pol115/run-pol115-334.sh" "$root" "$work/source" "$sha" "$work" "$scope" --host-only ;;
      issue417) bash "$plan/expense-witness/run.sh" "$root" "$work/source" "$sha" "$work" --issue417-history-expense --host-only ;;
      pol275)
        bash "$plan/pol275/run-pol275-cold.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only
        git -C "$root" merge-base --is-ancestor "$4" "$sha"
        git -C "$root" worktree add --detach "$work/predecessor" "$4"
        trap 'git -C "$root" worktree remove "$work/predecessor"' EXIT
        bash "$plan/prepare.sh" "$work/predecessor" "$4" "$work/predecessor-source"
        bash "$plan/pol275/run-pol275.sh" "$work/predecessor" "$work/predecessor-source" "$4" "$work" collision --host-only
        bash "$plan/pol275/prepare-warm-image.sh" "$root" "$work/source" "$sha" "$work/warm" "$3"
        bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/warm" warm "$3" --host-only ;;
      bank) bash "$plan/run-bank-restore.sh" "$work/source" "$sha" --host-only bank "$3" --host-only ;;
      cash-handover|principal-return) bash "$plan/run-task398-cash-principal.sh" "$root" "$work/source" "$sha" "$work" "$lane" --host-only ;;
      company-proxy) bash "$plan/run-task410-company-proxy.sh" "$root" "$work/source" "$sha" "$work" --host-only ;;
      pfq) bash "$plan/run-pfq.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      pol109) bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      pol108-core|pol108-facts|pol108-impacts) bash "$plan/run-pol108.sh" "$root" "$work/source" "$sha" "$work" "${lane#pol108-}" "$3" --host-only ;;
      onboarding) bash "$plan/onboarding/run-onboarding295.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      procurement)
        for kind in general16 project11; do
          bash "$plan/procurement/run-procurement295.sh" "$root" "$work/source" "$sha" "$work" "$kind" "$3" --host-only
        done ;;
      line-a) bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work" original --host-only ;;
      core-payment) bash "$plan/run-core-payment.sh" "$work/source" "$sha" --host-only core "$3" ;;
      payment-execution) bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work" --host-only ;;
      settlement|template|draft) bash "$plan/run-contract-adjacent.sh" "$root" "$work/source" "$sha" "$work" "$lane" "$3" --host-only ;;
      v7|invoice|pol279|pol280) bash "$plan/run-finance-adjacent.sh" "$root" "$work/source" "$sha" "$work" "$lane" "$3" --host-only ;;
      expense-execution|expense-finance|expense-receipt) bash "$plan/run-expense.sh" "$root" "$work/source" "$sha" "$work" "${lane#expense-}" "$3" --host-only ;;
    esac
  elif [[ $signed_350 == true ]]; then
    case "$lane" in
      issue417) bash "$plan/expense-witness/run.sh" "$root" "$work/source" "$sha" "$work" --issue417-history-expense --host-only ;;
      line-a) bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work" original --host-only ;;
      payment-execution) bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work" --host-only ;;
      v7|invoice|pol279|pol280)
        bash "$plan/run-finance-adjacent.sh" "$root" "$work/source" "$sha" "$work" "$lane" "$3" --host-only ;;
      settlement|template|draft)
        bash "$plan/run-contract-adjacent.sh" "$root" "$work/source" "$sha" "$work" "$lane" "$3" --host-only ;;
      expense-execution|expense-finance|expense-receipt)
        bash "$plan/run-expense.sh" "$root" "$work/source" "$sha" "$work" "${lane#expense-}" "$3" --host-only ;;
      pol275)
        bash "$plan/pol275/run-pol275-cold.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only
        git -C "$root" merge-base --is-ancestor "$4" "$sha"
        git -C "$root" worktree add --detach "$work/predecessor" "$4"
        trap 'git -C "$root" worktree remove "$work/predecessor"' EXIT
        bash "$plan/prepare.sh" "$work/predecessor" "$4" "$work/predecessor-source"
        bash "$plan/pol275/run-pol275.sh" "$work/predecessor" "$work/predecessor-source" "$4" "$work" collision --host-only
        bash "$plan/pol275/prepare-warm-image.sh" "$root" "$work/source" "$sha" "$work/warm" "$3"
        bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/warm" warm "$3" --host-only
        ;;
      pfq)
        bash "$plan/run-pfq.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      company-proxy)
        bash "$plan/run-task410-company-proxy.sh" "$root" "$work/source" "$sha" "$work" --host-only ;;
      cash-handover|principal-return)
        bash "$plan/run-task398-cash-principal.sh" "$root" "$work/source" "$sha" "$work" "$lane" --host-only ;;
      pol108-core|pol108-facts|pol108-impacts)
        bash "$plan/run-pol108.sh" "$root" "$work/source" "$sha" "$work" "${lane#pol108-}" "$3" --host-only ;;
      pol109)
        bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" --host-only "$3" --host-only ;;
      onboarding)
        bash "$plan/onboarding/run-onboarding295.sh" "$root" "$work/source" "$sha" "$work" "$3" --host-only ;;
      procurement)
        for kind in general16 project11; do
          bash "$plan/procurement/run-procurement295.sh" "$root" "$work/source" "$sha" "$work" "$kind" "$3" --host-only
        done
        ;;
    esac
  elif [[ $lane == task398-competition ]]; then
    bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work" competition-346 --host-only
  elif [[ $lane == pol109 ]]; then
    bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" "$work" --expense-witness-346 --host-only
  elif [[ $lane == cash-transfer || $lane == project-advance ]]; then
    bash "$plan/run-task398-cash-principal.sh" "$root" "$work/source" "$sha" "$work" "$lane" --host-only
  else
    bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work" --host-only
  fi
  exit 0
fi
source "$plan/local-build-images.sh"
qualification_image_scope "$work"
predecessor_worktree=
cleanup() {
  local status=$1
  if [[ -n $predecessor_worktree ]]; then
    git -C "$root" worktree remove "$predecessor_worktree" || { [[ $status != 0 ]] || status=1; }
  fi
  qualification_image_exit "$status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bash "$plan/prepare.sh" "$root" "$sha" "$work/source" ${mode_args[@]+"${mode_args[@]}"}
profile=browser
case "$lane" in pol115-original|pol115-spot|pol115-workbench|pol115-full|onboarding|procurement) profile=mobile ;; line-a|historical-takeover-a28|historical-takeover-a29) profile=api ;; esac
if [[ ( $lane == task398-ledger-loss || $lane == task398-competition ) && $3 == --expense-witness-346 ]]; then profile=api; fi
if [[ $issue_lane == true ]]; then profile=api; fi
bash "$plan/build.sh" "$work/source" "$sha" "$profile" "$work/browser"
if [[ $signed_issue_ordered == true ]]; then
  for scope in "${signed_issue_scopes[@]}"; do
    bash "$plan/issue-ordered/run.sh" "$root" "$work/source" "$sha" "$work/browser" "$scope"
  done
  exit 0
fi
if [[ $issue_lane == true ]]; then
  case "$lane" in
    issue404_matrix_349)
      for scope in issue404_349 issue426_a01_349; do
        bash "$plan/issue-ordered/run.sh" "$root" "$work/source" "$sha" "$work/browser" "$scope"
      done
      ;;
    issue417)
      bash "$plan/expense-witness/run.sh" "$root" "$work/source" "$sha" "$work/browser" --issue417-history-expense
      ;;
    issue418-operating)
      # Each profile runs on a fresh database; guarded writers preserve the release ACL.
      scopes=$(node -p '
        const profiles = require(process.argv[1]);
        const scopes = process.argv[2] === "--expense-witness-349" ? profiles.issue418OperatingScopes349 : profiles.issue418OperatingScopes;
        scopes.join(" ")
      ' "$plan/issue-ordered/profiles.cjs" "$3")
      read -r -a profiles <<< "$scopes"
      for scope in "${profiles[@]}"; do
        bash "$plan/issue-ordered/run.sh" "$root" "$work/source" "$sha" "$work/browser" "$scope"
      done
      ;;
    *) bash "$plan/issue-ordered/run.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ;;
  esac
  exit 0
fi
case "$lane" in
  line-a)
    line_a_args=()
    if [[ ${3:-} == --historical-settlement-334 || ${3:-} == --expense-witness-34[69] || $signed_350 == true || $company_352 == true ]]; then line_a_args=(original); fi
    bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work/browser" ${line_a_args[@]+"${line_a_args[@]}"}
    ;;
  historical-takeover-a28)
    if [[ $3 == --expense-witness-34[69] || $company_352 == true ]]; then
      bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work/browser" --a28-continuation
    else
      bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work/browser"
    fi ;;
  historical-takeover-a29) bash "$plan/run-line-a.sh" "$work/source" "$sha" "$work/browser" --a29-opening ;;
  task398-ledger-loss)
    variant=ledger-loss-330
    case "$3" in
      --payment-remainder-331) variant=ledger-loss-331 ;;
      --upward-archive-332) variant=ledger-loss-332 ;;
      --expense-witness-346) variant=ledger-loss-346 ;;
    esac
    bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" "$variant" ;;
  task398-competition)
    bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" competition-346 ;;
  task398-standard)
    if [[ ${3:-} == --expense-witness-34[69] || $company_352 == true ]]; then
      count=${3##*-}
      for variant in "standard-$count" "text-direct-$count"; do
        bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" "$variant"
      done
      exit 0
    fi
    if [[ ${3:-} == --text-direct-330 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-330
    elif [[ ${3:-} == --payment-remainder-331 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-331
    elif [[ ${3:-} == --upward-archive-332 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-332
    elif [[ ${3:-} == --historical-settlement-334 ]]; then
      bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser" standard-334
    fi
    bash "$plan/run-task398-standard.sh" "$root" "$work/source" "$sha" "$work/browser"
    ;;
  cash-handover|principal-return|cash-transfer|project-advance) bash "$plan/run-task398-cash-principal.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ;;
  expense-execution|expense-finance|expense-receipt)
    expense_args=()
    if [[ ${3:-} == --expense-witness-34[69] || $signed_350 == true || $company_352 == true ]]; then expense_args=("$3"); fi
    bash "$plan/run-expense.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#expense-}" ${expense_args[@]+"${expense_args[@]}"}
    ;;
  bank) bash "$plan/run-bank-restore.sh" "$work/source" "$sha" "$work/browser" bank "$3" ;;
  core-payment) bash "$plan/run-core-payment.sh" "$work/source" "$sha" "$work/browser" core "$3" ;;
  payment-execution) bash "$plan/run-payment-execution.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  company-proxy) bash "$plan/run-task410-company-proxy.sh" "$root" "$work/source" "$sha" "$work/browser" ;;
  browser-partial|browser-completion)
    browser_args=()
    if [[ ${3:-} == --expense-witness-34[69] || $company_352 == true ]]; then browser_args=("$3"); fi
    bash "$plan/$lane/run-$lane.sh" "$root" "$work/source" "$sha" "$work/browser" ${browser_args[@]+"${browser_args[@]}"}
    ;;
  v7|invoice|pol279|pol280) bash "$plan/run-finance-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol108-core|pol108-facts|pol108-impacts) bash "$plan/run-pol108.sh" "$root" "$work/source" "$sha" "$work/browser" "${lane#pol108-}" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol109) bash "$plan/run-pol109.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol115-original|pol115-spot)
    scope=pol115; if [[ $lane == pol115-spot ]]; then scope=spot; fi
    bash "$plan/pol115/run-pol115-334.sh" "$root" "$work/source" "$sha" "$work/browser" "$scope" ;;
  pol115-full)
    for scope in pol115 spot; do
      bash "$plan/pol115/run-pol115-334.sh" "$root" "$work/source" "$sha" "$work/browser" "$scope"
    done
    bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work/browser" "${mode_args[@]}"
    ;;
  pol115-workbench) bash "$plan/workbench/run-workbench295.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pfq) bash "$plan/run-pfq.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  pol275)
    bash "$plan/pol275/run-pol275-cold.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"}
    if [[ $# == 4 ]]; then
      predecessor=$4
      git -C "$root" merge-base --is-ancestor "$predecessor" "$sha"
      git -C "$root" worktree add --detach "$work/predecessor" "$predecessor"
      predecessor_worktree="$work/predecessor"
      bash "$plan/prepare.sh" "$work/predecessor" "$predecessor" "$work/predecessor-source"
      bash "$plan/build.sh" "$work/predecessor-source" "$predecessor" browser "$work/predecessor-browser"
      bash "$plan/pol275/run-pol275.sh" "$work/predecessor" "$work/predecessor-source" "$predecessor" "$work/predecessor-browser" collision
    else
      bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/browser" collision
    fi
    bash "$plan/pol275/prepare-warm-image.sh" "$root" "$work/source" "$sha" "$work/warm" ${mode_args[@]+"${mode_args[@]}"}
    context_sha=$(cat "$work/warm/context.sha256")
    docker build --platform linux/amd64 --target pol275-warm \
      --file "$work/warm/Dockerfile" --iidfile "$work/warm/image.id" \
      --label "org.jiangkong.contract-finance.source-sha=$sha" \
      --label "org.jiangkong.contract-finance.context-sha256=$context_sha" \
      --label "org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN" "$work/warm/context"
    bash "$plan/pol275/run-pol275.sh" "$root" "$work/source" "$sha" "$work/warm" warm ${mode_args[@]+"${mode_args[@]}"}
    ;;
  onboarding) bash "$plan/onboarding/run-onboarding295.sh" "$root" "$work/source" "$sha" "$work/browser" ${mode_args[@]+"${mode_args[@]}"} ;;
  procurement)
    for kind in general16 project11; do
      bash "$plan/procurement/run-procurement295.sh" "$root" "$work/source" "$sha" "$work/browser" "$kind" ${mode_args[@]+"${mode_args[@]}"}
    done
    ;;
  *) bash "$plan/run-contract-adjacent.sh" "$root" "$work/source" "$sha" "$work/browser" "$lane" ${mode_args[@]+"${mode_args[@]}"} ;;
esac
