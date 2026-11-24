# Reclaim only images exported by the current local qualification run.
qualification_image_scope() {
  JG_QUALIFICATION_LOCAL_RUN=
  if [[ ${GITHUB_ACTIONS:-} != true ]]; then
    JG_QUALIFICATION_LOCAL_RUN=$(node -p 'require("node:crypto").randomUUID()')
    if [[ -n ${1:-} ]]; then
      (set -o noclobber; printf '%s\n' "$JG_QUALIFICATION_LOCAL_RUN" > "$1/local-image-run.id")
    fi
  fi
  export JG_QUALIFICATION_LOCAL_RUN
}

qualification_image_cleanup() {
  local images image cleanup_failed=0
  [[ -n ${JG_QUALIFICATION_LOCAL_RUN:-} ]] || return 0
  if ! images=$(docker image ls -aq --no-trunc --filter "label=org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN"); then
    printf '%s\n' 'Local qualification images could not be listed.' >&2
    return 1
  fi
  while IFS= read -r image; do
    [[ -n $image ]] || continue
    docker image rm --no-prune "$image" >/dev/null || cleanup_failed=1
  done <<< "$images"
  return "$cleanup_failed"
}

qualification_image_exit() {
  local exit_code=$1
  qualification_image_cleanup || { [[ $exit_code != 0 ]] || exit_code=1; }
  exit "$exit_code"
}
