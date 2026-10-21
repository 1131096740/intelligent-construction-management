#!/usr/bin/env bash
# Keep the approved deployment and its recovery independent of the SSH observer.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_ROOT="${DEPLOY_SESSION_ROOT:-/srv/jiangkong/.deploy-sessions}"

fail() { echo "deployment session: $*" >&2; exit 1; }
[[ "$SESSION_ROOT" == /* && ! -L "$SESSION_ROOT" ]] || fail "session root must be an absolute non-symlink directory"

# Status is strictly read-only, including when the directory does not exist.
if [[ "${1:-}" == --status ]]; then
  [[ $# == 2 && "$2" =~ ^session\.[A-Za-z0-9]+$ ]] || fail "invalid session ID"
  session="$SESSION_ROOT/$2"
  [[ -d "$session" && ! -L "$session" ]] || fail "session does not exist"
  cat "$session/target-sha"
  if [[ -f "$session/result.json" ]]; then
    cat "$session/result.json"
    exit 0
  fi
  echo "No terminal result yet. Inspect the private deployment log; do not restart deployment."
  exit 3
fi
[[ $# == 0 ]] || fail "usage: deploy-production-session.sh [--status session.ID]"
[[ "${TARGET_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail "TARGET_SHA must be an exact commit SHA"
deployment_umask="$(umask)"
umask 077
mkdir -p "$SESSION_ROOT"
metadata="$(stat -c '%u:%a' "$SESSION_ROOT" 2>/dev/null || stat -f '%u:%Lp' "$SESSION_ROOT")"
[[ "$metadata" == "$(id -u):700" ]] || fail "session root must be owned by the deployment user with mode 0700"
session="$(mktemp -d "$SESSION_ROOT/session.XXXXXXXX")"
printf '%s\n' "$TARGET_SHA" > "$session/target-sha"
printf 'Deployment session: %s\nPrivate log: %s/deploy.log\n' "${session##*/}" "$session"

# All three descriptors are detached from SSH. Ignored HUP is inherited by the
# actual server script, whose existing confirmation timeout and recovery still run.
# The launcher's fd 9 lock is inherited until this worker finishes, so a later
# workflow cannot change the checkout while a disconnected deployment is active.
nohup bash -c '
  session=$1
  server=$2
  set +e
  # Keep private receipt permissions here, but preserve the original build mask.
  (umask "$3"; export DEPLOY_EVIDENCE_DIR="$session/evidence"; bash "$server")
  result=$?
  printf "{\"targetSha\":\"%s\",\"exitCode\":%s}\n" "$TARGET_SHA" "$result" > "$session/result.json.tmp"
  mv "$session/result.json.tmp" "$session/result.json"
  exit "$result"
' bash "$session" "$SCRIPT_DIR/deploy-production-server.sh" "$deployment_umask" \
  </dev/null >"$session/deploy.log" 2>&1 &
worker=$!
# Only the worker should keep the deployment lock after a transport disconnect.
exec 9>&-
# Following logs is expendable: an EPIPE or HUP here cannot stop the worker.
tail -n +1 -f "$session/deploy.log" &
observer=$!
trap 'kill "$observer" 2>/dev/null || true' EXIT
set +e
wait "$worker"
result=$?
kill "$observer" 2>/dev/null
wait "$observer" 2>/dev/null
# Print the final tail after stopping the follower so completion is visible even
# for a fast deployment. The result exists only after server cleanup has returned.
tail -n 20 "$session/deploy.log"
if [[ -f "$session/result.json" ]]; then
  cat "$session/result.json"
else
  echo "Deployment has no terminal receipt; inspect session ${session##*/}." >&2
  result=1
fi
exit "$result"
