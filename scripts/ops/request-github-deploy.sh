#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GIT_BIN="${GIT_BIN:-git}"
GH_BIN="${GH_BIN:-gh}"
NODE_BIN="${NODE_BIN:-node}"
RECEIPT_TOOL="$SCRIPT_DIR/local-release-receipt.mjs"
TARGET_SHA=""
RECEIPT_PATH=""
CONFIRMATION=""
DEPLOY_SCOPE="full"
DEPLOY_CONFIRMATION_MODE="manual"
DEPLOY_CONFIRMATION_TIMEOUT_SECONDS="1800"
DRY_RUN=false

usage() {
  cat <<'USAGE'
Usage: pnpm deploy:local --target-sha <sha> --receipt <absolute-path> \
  --confirm 'DEPLOY JGZG PRODUCTION' [--scope full|api-only] \
  [--confirmation-mode manual|immediate] [--confirmation-timeout-seconds <seconds>] \
  [--dry-run]

Validates a complete local release receipt and the exact current origin/main SHA,
then manually dispatches the deploy-only GitHub workflow. This command never
opens an SSH connection to production.
USAGE
}

fail() {
  echo "GitHub deployment request: $*" >&2
  exit 1
}

while (( $# > 0 )); do
  case "$1" in
    --target-sha)
      [[ $# -ge 2 ]] || fail "--target-sha requires a 40-character SHA"
      TARGET_SHA=$2
      shift 2
      ;;
    --receipt)
      [[ $# -ge 2 ]] || fail "--receipt requires an absolute path"
      RECEIPT_PATH=$2
      shift 2
      ;;
    --confirm)
      [[ $# -ge 2 ]] || fail "--confirm requires the exact production confirmation"
      CONFIRMATION=$2
      shift 2
      ;;
    --scope)
      [[ $# -ge 2 ]] || fail "--scope requires full or api-only"
      DEPLOY_SCOPE=$2
      shift 2
      ;;
    --confirmation-mode)
      [[ $# -ge 2 ]] || fail "--confirmation-mode requires manual or immediate"
      DEPLOY_CONFIRMATION_MODE=$2
      shift 2
      ;;
    --confirmation-timeout-seconds)
      [[ $# -ge 2 ]] || fail "--confirmation-timeout-seconds requires a positive integer"
      DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=$2
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
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

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  fail "target SHA must be a lowercase 40-character commit ID"
[[ "$RECEIPT_PATH" == /* ]] || fail "receipt path must be absolute"
[[ "$CONFIRMATION" == "DEPLOY JGZG PRODUCTION" ]] ||
  fail "production confirmation must exactly match DEPLOY JGZG PRODUCTION"
case "$DEPLOY_SCOPE" in
  full|api-only)
    ;;
  *)
    fail "deployment scope must be full or api-only"
    ;;
esac
case "$DEPLOY_CONFIRMATION_MODE" in
  manual|immediate)
    ;;
  *)
    fail "deployment confirmation mode must be manual or immediate"
    ;;
esac
[[ "$DEPLOY_CONFIRMATION_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] &&
  (( DEPLOY_CONFIRMATION_TIMEOUT_SECONDS <= 3600 )) ||
  fail "deployment confirmation timeout must be between 1 and 3600 seconds"
[[ "$DEPLOY_SCOPE" != "full" || "$DEPLOY_CONFIRMATION_MODE" == "manual" ]] ||
  fail "full deployments require manual confirmation mode"

[[ -f "$RECEIPT_PATH" && ! -L "$RECEIPT_PATH" ]] ||
  fail "release receipt must be a regular file"
if ! receipt_json="$("$NODE_BIN" "$RECEIPT_TOOL" --dispatch-json \
  --receipt "$RECEIPT_PATH" --candidate-sha "$TARGET_SHA" 2>&1)"; then
  fail "$receipt_json"
fi

cd "$REPO_ROOT"
[[ "$("$GIT_BIN" rev-parse HEAD)" == "$TARGET_SHA" ]] ||
  fail "target SHA does not match the local checkout HEAD"
[[ -z "$("$GIT_BIN" status --porcelain=v1 --untracked-files=all)" ]] ||
  fail "local candidate worktree must be clean"
"$GIT_BIN" fetch --no-tags origin main:refs/remotes/origin/main
"$GIT_BIN" cat-file -e "$TARGET_SHA^{commit}"
[[ "$("$GIT_BIN" rev-parse refs/remotes/origin/main)" == "$TARGET_SHA" ]] ||
  fail "target SHA does not match origin/main"

if [[ "$DRY_RUN" == true ]]; then
  printf 'Dry run passed for %s (scope: %s, confirmation: %s). GitHub was not invoked.\n' \
    "$TARGET_SHA" "$DEPLOY_SCOPE" "$DEPLOY_CONFIRMATION_MODE"
  exit 0
fi

"$GH_BIN" workflow run deploy-production.yml \
  --ref main \
  --raw-field "target_sha=$TARGET_SHA" \
  --raw-field "production_confirmation=$CONFIRMATION" \
  --raw-field "release_receipt_json=$receipt_json" \
  --raw-field "deployment_scope=$DEPLOY_SCOPE" \
  --raw-field "confirmation_mode=$DEPLOY_CONFIRMATION_MODE" \
  --raw-field "confirmation_timeout_seconds=$DEPLOY_CONFIRMATION_TIMEOUT_SECONDS"

printf 'GitHub deployment workflow requested for %s (scope: %s, confirmation: %s).\n' \
  "$TARGET_SHA" "$DEPLOY_SCOPE" "$DEPLOY_CONFIRMATION_MODE"
