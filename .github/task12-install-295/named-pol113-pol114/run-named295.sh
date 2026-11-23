#!/bin/bash
set -euo pipefail
umask 077
[[ $# == 5 && ( $1 == pol113 || $1 == pol114 ) ]]
mode=$1
generated=$(cd "$2" && pwd -P)
prepared=$(cd "$3" && pwd -P)
ref=$4
evidence=$5
[[ "$ref" =~ ^[a-f0-9]{40}$ ]]
node - "$generated/context/candidate-admission.json" "$prepared/source.json" "$ref" <<'JS'
const [candidateFile,sourceFile,sha]=process.argv.slice(2);
const a=require(candidateFile),s=require(sourceFile);
const current320=s.mode==='current-320';
const count=current320?328:295;
if(a.candidateSha!==sha||s.sourceSha!==sha||s.migrationCount!==count||a.migrationCount!==count||
  a.ledger295!==(current320?s.predecessor.ledgerSha256:s.ledgerSha256))process.exit(65);
if(current320&&(a.ledger320!==s.ledgerSha256||a.sourceTree!==s.sourceTree||
  JSON.stringify(a.tails)!==JSON.stringify(s.tails)))process.exit(65);
JS
(cd "$generated/context" && shasum -a 256 -c ../context.sha256 >/dev/null)
[[ -z $(docker ps -q) ]]
if pgrep -x postgres >/dev/null; then exit 65; fi
mkdir "$evidence"
evidence=$(cd "$evidence" && pwd -P)
seal=$(shasum -a 256 "$generated/context.sha256" | cut -d' ' -f1)
build_pol114=0
[[ $mode != pol114 ]] || build_pol114=1
docker build --platform linux/amd64 --iidfile "$evidence/image.id" \
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
docker run "${sandbox[@]}" --entrypoint node "$image" /qualification/loader-preflight.cjs --materials >"$evidence/preflight.json"
[[ -z $(docker ps -q) ]]
if pgrep -x postgres >/dev/null; then exit 65; fi
mkdir "$generated/consumed-$mode"
status=0
docker run "${sandbox[@]}" --entrypoint node "$image" /qualification/install-only.cjs "$mode" \
  > "$evidence/receipt.json" 2> "$evidence/private.stderr" || status=$?
(( status == 0 )) || exit "$status"
node - "$evidence/receipt.json" "$mode" "$ref" "$prepared/source.json" <<'JS'
const assert=require('node:assert/strict');
const [receipt,mode,sha,source]=process.argv.slice(2),r=require(receipt);
assert.equal(r.mode,mode); assert.equal(r.candidateSha,sha);
assert.equal(r.status,'POL113_POL114_NAMED_EXACT_'+require(source).migrationCount+'_PASSED');
JS
