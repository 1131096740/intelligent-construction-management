#!/bin/bash
set -euo pipefail
umask 077
[[ ( $# == 5 || ( $# == 6 && $6 == --host-only ) ) && ( $1 == pol113 || $1 == pol114 ) ]]
mode=$1
generated=$(cd "$2" && pwd -P)
prepared=$(cd "$3" && pwd -P)
ref=$4
evidence=$5
[[ "$ref" =~ ^[a-f0-9]{40}$ ]]
plan=$(cd "$(dirname "$0")" && pwd -P)
node - "$generated/context/candidate-admission.json" "$prepared/source.json" "$ref" "$plan" <<'JS'
const [candidateFile,sourceFile,sha,plan]=process.argv.slice(2);
const a=require(candidateFile),s=require(sourceFile);
const expenseWitness=s.mode==='expense-witness-346';
const historicalSettlement=expenseWitness||s.mode==='historical-settlement-334';
const upwardArchive=historicalSettlement||s.mode==='upward-archive-332';
const paymentRemainder=upwardArchive||s.mode==='payment-remainder-331';
const textDirect=s.mode==='text-direct-330'||paymentRemainder;
const current320=textDirect||s.mode==='current-320';
const count=expenseWitness?346:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
if(a.candidateSha!==sha||s.sourceSha!==sha||s.migrationCount!==count||a.migrationCount!==count||
  a.ledger295!==(current320?s.predecessor.ledgerSha256:s.ledgerSha256))process.exit(65);
if(current320&&((expenseWitness?a.ledger346:historicalSettlement?a.ledger334:upwardArchive?a.ledger332:a.ledger320)!==s.ledgerSha256||a.sourceTree!==s.sourceTree||
  JSON.stringify(a.tails)!==JSON.stringify(s.tails)))process.exit(65);
if(textDirect&&a.ledger329!=="3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2")process.exit(65);
if(paymentRemainder){
  const finance=plan+'/../contract-finance';
  const profile=upwardArchive?'upward-archive-332':'payment-remainder-331';
  const base=require(finance+'/common/multi-witness.cjs').final;
  if(historicalSettlement){
    if(expenseWitness){
      require(finance+'/expense-witness-346-profile.cjs').assertSource(s,base);
      if(a.ledger334!==s.predecessor334.ledgerSha256)process.exit(65);
    } else require(finance+'/historical-settlement-334-profile.cjs').assertSource(s,base);
    if(a.ledger332!==s.predecessor332.ledgerSha256||a.ledger333!==s.predecessor333.ledgerSha256)process.exit(65);
  } else require(finance+'/'+profile+'-profile.cjs').assertSource(s,sha,base);
  if(a.ledger330!==s.predecessor330.ledgerSha256)process.exit(65);
  if(upwardArchive&&a.ledger331!==s.predecessor331.ledgerSha256)process.exit(65);
}
JS
(cd "$generated/context" && shasum -a 256 -c ../context.sha256 >/dev/null)
if [[ ${6-} == --host-only ]]; then
  count=$(node -p 'require(process.argv[1]).migrationCount' "$prepared/source.json")
  [[ $count == 334 || $count == 346 ]] || exit 64
  printf 'NAMED_%s_HOST_READY mode=%s sha=%s context=%s\n' "$count" "$mode" "$ref" "$(shasum -a 256 "$generated/context.sha256" | cut -d' ' -f1)"
  exit 0
fi
[[ -z $(docker ps -q) ]]
if pgrep -x postgres >/dev/null; then exit 65; fi
mkdir "$evidence"
evidence=$(cd "$evidence" && pwd -P)
source "$plan/../contract-finance/local-build-images.sh"
qualification_image_scope "$evidence"
trap 'qualification_image_exit "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
seal=$(shasum -a 256 "$generated/context.sha256" | cut -d' ' -f1)
build_pol114=0
[[ $mode != pol114 ]] || build_pol114=1
docker build --platform linux/amd64 --iidfile "$evidence/image.id" \
  --label "org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN" \
  --build-arg "JG_NAMED_BUILD_POL114=$build_pol114" --build-arg "JG_NAMED_CANDIDATE_SHA=$ref" \
  --build-arg "JG_NAMED_CONTEXT_SHA=$seal" "$generated/context"
image=$(cat "$evidence/image.id")
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ $(docker image inspect "$image" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.jiangkong.isolated-context-sha"}} {{index .Config.Labels "org.jiangkong.ci.candidate-sha"}}') == "$image linux/amd64 $seal $ref" ]]
sandbox=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
  --tmpfs /tmp:rw,noexec,nosuid,size=512m
  --mount "type=bind,src=$prepared/prepared/product/predecessor,dst=/qualification/product,readonly"
  --mount "type=bind,src=$prepared/prepared/product/intermediate,dst=/qualification/product291,readonly"
  --env "JG_NAMED_CANDIDATE_SHA=$ref")
docker run "${sandbox[@]}" --entrypoint node "$image" /qualification/loader-preflight.cjs --materials \
  >"$evidence/preflight.json" 2>"$evidence/preflight.stderr" || {
  status=$?
  printf 'POL113_POL114_PREFLIGHT_FAILED mode=%s exit=%s\n' "$mode" "$status" >&2
  exit "$status"
}
[[ -z $(docker ps -q) ]]
if pgrep -x postgres >/dev/null; then exit 65; fi
mkdir "$generated/consumed-$mode"
status=0
docker run "${sandbox[@]}" --entrypoint node "$image" /qualification/install-only.cjs "$mode" \
  > "$evidence/receipt.json" 2> "$evidence/private.stderr" || status=$?
if (( status != 0 )); then
  node - "$evidence/receipt.json" "$mode" "$ref" >&2 <<'JS' || true
const [file,mode,sha]=process.argv.slice(2);
let receipt;
try { receipt=JSON.parse(require('node:fs').readFileSync(file,'utf8')); } catch { process.exit(1); }
if(receipt?.mode!==mode||receipt.candidateSha!==sha||receipt.status!=='STOPPED')process.exit(1);
const failure={mode};
for(const key of ['stage','code','sqlstate','prismaCode']){
  const value=receipt.failure?.[key];
  if(typeof value==='string'&&/^[A-Z0-9_]{1,96}$/u.test(value))failure[key]=value;
}
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000;
if(receipt.originalSuite){
  failure.suite=Object.fromEntries(
    ['total','passed','skipped','exit'].filter(key=>count(receipt.originalSuite[key]))
      .map(key=>[key,receipt.originalSuite[key]])
  );
}
if(Array.isArray(receipt.jestDiagnostic?.failed)){
  failure.cases=receipt.jestDiagnostic.failed.slice(0,6).map(row=>({
    titleSha256:typeof row?.titleSha256==='string'&&/^[0-9a-f]{64}$/u.test(row.titleSha256)?row.titleSha256:undefined,
    frames:Array.isArray(row?.frames)?row.frames.filter(frame=>Array.isArray(frame)&&
      frame.length===2&&frame.every(count)).slice(0,4):[],
    statuses:Array.isArray(row?.statuses)?row.statuses.filter(value=>Number.isInteger(value)&&
      value>=100&&value<=599).slice(0,4):[],
    signedSettlementFailure:Array.isArray(row?.signedSettlementFailure)?row.signedSettlementFailure
      .filter(value=>typeof value==='string'&&/^POL114_SIGNED_SETTLEMENT_[A-Z0-9_]{1,80}$/u.test(value)).slice(0,3):undefined
  }));
}
const lanes=mode==='pol114'?['layout','settlement']:['project'];
for(const lane of lanes){
  const rows=receipt.browser?.[lane];
  if(!Array.isArray(rows))continue;
  failure[lane]=rows.slice(0,8).map(row=>{
    const summary=Object.fromEntries(
      ['total','passed','unexpected'].filter(key=>count(row?.[key])).map(key=>[key,row[key]])
    );
    if(Array.isArray(row?.failures)&&row.failures.length) summary.cases=row.failures.slice(0,6).map(test=>({
      project:['desktop','mobile','chromium','webkit-mobile'].includes(test?.project)?test.project:undefined,
      titleSha256:typeof test?.titleSha256==='string'&&/^[0-9a-f]{64}$/u.test(test.titleSha256)?test.titleSha256:undefined,
      kind:['TIMEOUT','ASSERTION','NAVIGATION_ABORTED','BROWSER_CLOSED','OTHER'].includes(test?.kind)?test.kind:undefined,
      spec:typeof test?.spec==='string'&&/^pol113-(?:project-profile|business-party|company-entity|settings)-real[.]e2e[.]ts$/u.test(test.spec)?test.spec:undefined,
      line:count(test?.line)?test.line:undefined,
      column:count(test?.column)?test.column:undefined
    }));
    return summary;
  });
}
process.stderr.write('POL113_POL114_FAILURE '+JSON.stringify(failure)+'\n');
JS
  exit "$status"
fi
node - "$evidence/receipt.json" "$mode" "$ref" "$prepared/source.json" <<'JS'
const assert=require('node:assert/strict');
const [receipt,mode,sha,source]=process.argv.slice(2),r=require(receipt);
assert.equal(r.mode,mode); assert.equal(r.candidateSha,sha);
assert.equal(r.status,'POL113_POL114_NAMED_EXACT_'+require(source).migrationCount+'_PASSED');
JS
