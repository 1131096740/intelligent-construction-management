# Reclaim only images exported by the current local qualification run.
qualification_image_scope() {
  JG_QUALIFICATION_LOCAL_RUN=
  if [[ ${GITHUB_ACTIONS:-} != true ]]; then
    JG_QUALIFICATION_LOCAL_RUN=$(node -p 'require("node:crypto").randomUUID()')
  fi
  export JG_QUALIFICATION_LOCAL_RUN
}

qualification_image_cleanup() {
  local images image
  [[ -n ${JG_QUALIFICATION_LOCAL_RUN:-} ]] || return 0
  if ! images=$(docker image ls -aq --no-trunc --filter "label=org.jiangkong.local-run=$JG_QUALIFICATION_LOCAL_RUN"); then
    printf '%s\n' 'Local qualification images could not be listed.' >&2
    return 0
  fi
  while IFS= read -r image; do
    [[ -n $image ]] || continue
    docker image rm "$image" >/dev/null || true
  done <<< "$images"
}
