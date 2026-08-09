#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
PNPM_BIN="${PNPM_BIN:-pnpm}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
GIT_BIN="${GIT_BIN:-git}"
RECEIPT_TOOL="$SCRIPT_DIR/local-release-receipt.mjs"
PREFLIGHT_ONLY=false
LIST_CHECKS=false
CANDIDATE_SHA=""
RECEIPT_PATH=""

usage() {
  cat <<'USAGE'
Usage: pnpm release:local [--preflight] [--candidate-sha <sha>] [--receipt <absolute-path>]

Runs the complete local release gate. It never connects to production, invokes
GitHub Actions, or uses a remote Docker endpoint.

Options:
  --preflight             Validate the local release environment without tests.
  --candidate-sha <sha>   Require this exact clean checkout SHA (defaults to HEAD).
  --receipt <path>        Write the passed receipt to this absolute path.
  --list-checks           Print the checks in the release gate and exit.
  -h, --help              Show this help.
USAGE
}

fail() {
  echo "local release gate: $*" >&2
  exit 1
}

print_checks() {
  "$NODE_BIN" "$RECEIPT_TOOL" --list-checks
}

while (( $# > 0 )); do
  case "$1" in
    --preflight)
      PREFLIGHT_ONLY=true
      shift
      ;;
    --candidate-sha)
      [[ $# -ge 2 ]] || fail "--candidate-sha requires a 40-character SHA"
      CANDIDATE_SHA=$2
      shift 2
      ;;
    --receipt)
      [[ $# -ge 2 ]] || fail "--receipt requires an absolute path"
      RECEIPT_PATH=$2
      shift 2
      ;;
    --list-checks)
      LIST_CHECKS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ "$LIST_CHECKS" == true ]]; then
  print_checks
  exit 0
fi

node_version="$($NODE_BIN -p 'process.versions.node' 2>/dev/null || true)"
[[ "$node_version" =~ ^20\.[0-9]+\.[0-9]+$ ]] ||
  fail "Node.js 20 is required; found ${node_version:-unavailable}"
pnpm_version="$($PNPM_BIN --version 2>/dev/null || true)"
[[ "$pnpm_version" =~ ^9\.[0-9]+\.[0-9]+$ ]] ||
  fail "pnpm 9 is required; found ${pnpm_version:-unavailable}"

cd "$REPO_ROOT"
actual_sha="$($GIT_BIN rev-parse HEAD)"
[[ "$actual_sha" =~ ^[0-9a-f]{40}$ ]] || fail "unable to resolve a 40-character candidate SHA"
if [[ -n "$CANDIDATE_SHA" && "$CANDIDATE_SHA" != "$actual_sha" ]]; then
  fail "candidate SHA does not match HEAD"
fi
CANDIDATE_SHA="$actual_sha"

[[ -z "$($GIT_BIN status --porcelain=v1 --untracked-files=all)" ]] ||
  fail "candidate worktree must be clean"

if env | awk -F= '$1 == "DATABASE_URL" || $1 ~ /_DATABASE_URL$/ { found = 1 } END { exit !found }'; then
  fail "DATABASE_URL and *_DATABASE_URL must be absent for the local PostgreSQL 16 gate"
fi

docker_host="$($DOCKER_BIN context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
case "$docker_host" in
  unix://*|npipe://*)
    ;;
  *)
    fail "Docker must use a local Unix socket or Windows named pipe"
    ;;
esac

$DOCKER_BIN image inspect postgres:16 >/dev/null 2>&1 ||
  fail "postgres:16 is not cached locally; run 'docker pull postgres:16' once before the gate"

if [[ -z "$RECEIPT_PATH" ]]; then
  state_root="${XDG_STATE_HOME:-$HOME/.local/state}/jiangkong"
  RECEIPT_PATH="$state_root/local-release-$CANDIDATE_SHA.json"
fi
[[ "$RECEIPT_PATH" == /* ]] || fail "receipt path must be absolute"
receipt_dir="$(dirname "$RECEIPT_PATH")"

if [[ "$PREFLIGHT_ONLY" == true ]]; then
  printf 'Local release preflight passed for %s\n' "$CANDIDATE_SHA"
  printf 'A successful full gate will write: %s\n' "$RECEIPT_PATH"
  exit 0
fi

run_check() {
  local check=$1
  shift
  printf '\n==> %s\n' "$check"
  "$@"
}

run_check ci-orchestration "$PNPM_BIN" test:ci-orchestration
run_check frozen-dependency-install env CI=true "$PNPM_BIN" install --frozen-lockfile
run_check prisma-client-generation "$PNPM_BIN" --filter @jiangkong/api exec prisma generate
run_check production-dependency-audit "$PNPM_BIN" audit --prod --audit-level high
run_check workspace-typecheck "$PNPM_BIN" typecheck
run_check web-e2e-typecheck "$PNPM_BIN" --filter @jiangkong/web-admin typecheck:e2e
run_check workspace-lint "$PNPM_BIN" lint
run_check business-errors-self-test "$NODE_BIN" services/api/scripts/check-business-errors.self-test.cjs
run_check api-business-errors "$PNPM_BIN" --filter @jiangkong/api check:business-errors
run_check operations-safety-self-test bash scripts/ops/go-live-safety-self-test.sh
run_check workspace-test "$PNPM_BIN" test
run_check api-production-build "$PNPM_BIN" --filter @jiangkong/api build
run_check web-production-build "$PNPM_BIN" --filter @jiangkong/web-admin build
run_check web-ui-governance "$PNPM_BIN" --filter @jiangkong/web-admin check:ui
run_check release-manifests "$PNPM_BIN" inspect:release-manifests
run_check exact-sha-postgresql-16 "$NODE_BIN" services/api/prisma/run-database-dynamic-gate-local.cjs \
  --execute --candidate-sha "$CANDIDATE_SHA" --confirm LOCAL_PG16_DYNAMIC_GATE
run_check playwright-browser-install "$PNPM_BIN" --filter @jiangkong/web-admin exec playwright install chromium webkit
run_check playwright-p0 "$PNPM_BIN" --filter @jiangkong/web-admin test:e2e:p0
run_check playwright-rc06-mock "$PNPM_BIN" --filter @jiangkong/web-admin test:e2e:rc06:mock

mkdir -p "$receipt_dir"
receipt_temp="$(mktemp "$receipt_dir/.local-release-${CANDIDATE_SHA}.XXXXXX")"
umask 077
checks_json="$("$NODE_BIN" "$RECEIPT_TOOL" --checks-json)"
printf '{\n  "schemaVersion": 1,\n  "status": "passed",\n  "candidateSha": "%s",\n  "verifiedAt": "%s",\n  "nodeVersion": "%s",\n  "pnpmVersion": "%s",\n  "checks": %s\n}\n' \
  "$CANDIDATE_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$node_version" "$pnpm_version" "$checks_json" > "$receipt_temp"
chmod 600 "$receipt_temp"
mv -f "$receipt_temp" "$RECEIPT_PATH"
printf '\nLocal release gate passed for %s\nReceipt: %s\n' "$CANDIDATE_SHA" "$RECEIPT_PATH"
