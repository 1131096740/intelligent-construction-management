#!/bin/bash

# Append the selected installer to the caller's existing read-only mount list.
append_remaining_installer() {
  local source_mode=$1
  local retained=${2:-}
  local installer="$common/installer.cjs"
  if [[ $source_mode == expense-witness-346 ]]; then
    node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
    installer="$work/installer.cjs"
    (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer.patch")
    local expected
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/expense-witness-346-profile.cjs")
    [[ $(shasum -a 256 "$installer" | cut -d ' ' -f1) == "$expected" ]] || return 65
    if [[ $retained == retained ]]; then
      (cd "$work" && git apply --unidiff-zero "$plan/remaining-retained-346-installer.patch")
      expected=56f967b52054cf6d756997316a700324f2a8ac83bda6063f6fde20cd5ca0bb22
      [[ $(shasum -a 256 "$installer" | cut -d ' ' -f1) == "$expected" ]] || return 65
    fi
    local profile
    for profile in upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
      args+=(--mount "type=bind,src=$plan/$profile,dst=/qualification/$profile,readonly")
    done
  elif [[ $source_mode == historical-settlement-334 ]]; then
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
