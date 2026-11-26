#!/bin/bash

# Append the selected installer to the caller's existing read-only mount list.
append_remaining_installer() {
  local source_mode=$1
  local retained=${2:-}
  local installer="$common/installer.cjs"
  if [[ $source_mode == historical-settlement-334 ]]; then
    local installer_mode=$source_mode
    if [[ $retained == retained ]]; then installer_mode+=-remaining; fi
    node "$plan/stage-historical-takeover-333.cjs" "$work" "$installer_mode"
    installer="$work/installer.cjs"
    local profile
    for profile in historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs; do
      args+=(--mount "type=bind,src=$plan/$profile,dst=/qualification/$profile,readonly")
    done
  fi
  args+=(--mount "type=bind,src=$installer,dst=/qualification/installer.cjs,readonly")
}
