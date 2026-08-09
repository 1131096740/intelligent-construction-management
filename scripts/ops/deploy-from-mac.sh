#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GIT_BIN="${GIT_BIN:-git}"
SSH_BIN="${SSH_BIN:-ssh}"
TARGET_SHA=""
RECEIPT_PATH=""
CONFIRMATION=""
DEPLOY_SCOPE="full"
DRY_RUN=false

usage() {
  cat <<'USAGE'
Usage: pnpm deploy:local -- --target-sha <sha> --receipt <absolute-path> \
  --confirm 'DEPLOY JGZG PRODUCTION' [--scope full|api-only] [--dry-run]

Required local configuration (never commit these values):
  JGZG_DEPLOY_HOST
  JGZG_DEPLOY_USER
  JGZG_DEPLOY_IDENTITY_FILE
  JGZG_DEPLOY_KNOWN_HOSTS
Optional:
  JGZG_DEPLOY_PORT (defaults to 22)
USAGE
}

fail() {
  echo "local deployment: $*" >&2
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

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "target SHA must be a lowercase 40-character commit ID"
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

: "${JGZG_DEPLOY_HOST:?JGZG_DEPLOY_HOST is required}"
: "${JGZG_DEPLOY_USER:?JGZG_DEPLOY_USER is required}"
: "${JGZG_DEPLOY_IDENTITY_FILE:?JGZG_DEPLOY_IDENTITY_FILE is required}"
: "${JGZG_DEPLOY_KNOWN_HOSTS:?JGZG_DEPLOY_KNOWN_HOSTS is required}"
JGZG_DEPLOY_PORT="${JGZG_DEPLOY_PORT:-22}"

[[ "$JGZG_DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail "deployment host is invalid"
[[ "$JGZG_DEPLOY_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "deployment user is invalid"
[[ "$JGZG_DEPLOY_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( JGZG_DEPLOY_PORT <= 65535 )) ||
  fail "deployment port is invalid"
[[ -f "$JGZG_DEPLOY_IDENTITY_FILE" && ! -L "$JGZG_DEPLOY_IDENTITY_FILE" ]] ||
  fail "deployment identity file must be a regular file"
[[ -f "$JGZG_DEPLOY_KNOWN_HOSTS" && ! -L "$JGZG_DEPLOY_KNOWN_HOSTS" ]] ||
  fail "deployment known-hosts file must be a regular file"
[[ -f "$RECEIPT_PATH" && ! -L "$RECEIPT_PATH" ]] || fail "release receipt must be a regular file"

receipt_content="$(< "$RECEIPT_PATH")"
grep -Eq '"status"[[:space:]]*:[[:space:]]*"passed"' <<< "$receipt_content" ||
  fail "release receipt is not passed"
grep -Eq "\\\"candidateSha\\\"[[:space:]]*:[[:space:]]*\\\"$TARGET_SHA\\\"" <<< "$receipt_content" ||
  fail "release receipt does not match target SHA"

cd "$REPO_ROOT"
[[ "$($GIT_BIN rev-parse HEAD)" == "$TARGET_SHA" ]] ||
  fail "target SHA does not match the local checkout HEAD"
[[ -z "$($GIT_BIN status --porcelain=v1 --untracked-files=all)" ]] ||
  fail "local candidate worktree must be clean"
$GIT_BIN fetch --no-tags origin main:refs/remotes/origin/main
$GIT_BIN cat-file -e "$TARGET_SHA^{commit}"
$GIT_BIN merge-base --is-ancestor "$TARGET_SHA" origin/main ||
  fail "target SHA is not an ancestor of origin/main"

if [[ "$DRY_RUN" == true ]]; then
  printf 'Dry run passed for %s (scope: %s). SSH was not invoked.\n' "$TARGET_SHA" "$DEPLOY_SCOPE"
  exit 0
fi

"$SSH_BIN" \
  -i "$JGZG_DEPLOY_IDENTITY_FILE" \
  -p "$JGZG_DEPLOY_PORT" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$JGZG_DEPLOY_KNOWN_HOSTS" \
  "$JGZG_DEPLOY_USER@$JGZG_DEPLOY_HOST" \
  "env TARGET_SHA=$TARGET_SHA DEPLOY_SCOPE=$DEPLOY_SCOPE DEPLOY_CONFIRMATION_MODE=immediate bash -s" <<'REMOTE_DEPLOY'
set -euo pipefail

assert_clean_release_tree() {
  local entry status_output
  if ! status_output="$(git status --porcelain=v1 --untracked-files=all)"; then
    echo "unable to inspect the production release tree" >&2
    return 1
  fi
  while IFS= read -r entry; do
    case "$entry" in
      "" | "?? .deploy-backups/"* | "?? deploy.sh" | "?? deploy.sh.bak-20260706")
        ;;
      *)
        echo "release tree contains a non-allowlisted change: $entry" >&2
        exit 1
        ;;
    esac
  done <<< "$status_output"
}

assert_dependency_tree_writable() {
  local path
  for path in \
    /opt/jiangkong \
    /opt/jiangkong/node_modules \
    /opt/jiangkong/node_modules/.bin \
    /opt/jiangkong/services/api/node_modules \
    /opt/jiangkong/apps/web-admin/node_modules; do
    if [[ -e "$path" ]] &&
      { [[ ! -d "$path" ]] || [[ ! -w "$path" ]]; }; then
      echo "deployment dependency path is not writable by $(id -un): $path" >&2
      return 1
    fi
  done
}

git config --global --replace-all safe.directory /opt/jiangkong
cd /opt/jiangkong
assert_clean_release_tree
assert_dependency_tree_writable
git fetch origin main
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor "$TARGET_SHA" origin/main
git merge --ff-only "$TARGET_SHA"
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
assert_clean_release_tree
git rev-parse HEAD

/opt/jiangkong/scripts/ops/deploy-production-server.sh
REMOTE_DEPLOY
