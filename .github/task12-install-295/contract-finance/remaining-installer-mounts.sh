#!/bin/bash

# Append the selected installer to the caller's existing read-only mount list.
append_remaining_installer() {
  local source_mode=$1
  local retained=${2:-}
  local installer="$common/installer.cjs"
  if [[ $source_mode == signed-settlement-350 ]]; then
    [[ $retained == retained && ${GITHUB_ACTIONS:-} != true ]] || return 64
  fi
  if [[ $source_mode == expense-witness-346 || $source_mode == expense-witness-349 || $source_mode == signed-settlement-350 ]]; then
    local count=${source_mode##*-}
    node "$plan/stage-historical-takeover-333.cjs" "$work" historical-settlement-334
    installer="$work/installer.cjs"
    (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer.patch")
    if [[ $count != 346 ]]; then
      (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer-349.patch")
    fi
    if [[ $count == 350 ]]; then
      (cd "$work" && git apply --unidiff-zero "$plan/expense-witness/installer-350.patch")
    fi
    local expected
    expected=$(node -p 'require(process.argv[1]).installerSha256' "$plan/$source_mode-profile.cjs")
    [[ $(shasum -a 256 "$installer" | cut -d ' ' -f1) == "$expected" ]] || return 65
    if [[ $retained == retained ]]; then
      (cd "$work" && git apply --unidiff-zero "$plan/remaining-retained-$count-installer.patch")
      case $count in
        346) expected=56f967b52054cf6d756997316a700324f2a8ac83bda6063f6fde20cd5ca0bb22 ;;
        349) expected=8b502a6438c3a8a2f3ea100775c339ddde0602d8ffbe60c197ea0ab3a437b207 ;;
        350) expected=$(node -p 'require(process.argv[1]).retainedInstallerSha256' "$plan/$source_mode-profile.cjs") ;;
      esac
      [[ $(shasum -a 256 "$installer" | cut -d ' ' -f1) == "$expected" ]] || return 65
    fi
    chmod 0644 "$installer"
    local profile
    for profile in upward-archive-332-profile.cjs historical-takeover-333-profile.cjs historical-settlement-334-profile.cjs expense-witness-345-profile.cjs expense-witness-346-profile.cjs expense-witness-prefixes.json; do
      args+=(--mount "type=bind,src=$plan/$profile,dst=/qualification/$profile,readonly")
    done
    if [[ $count != 346 ]]; then
      args+=(--mount "type=bind,src=$plan/expense-witness-349-profile.cjs,dst=/qualification/expense-witness-349-profile.cjs,readonly")
    fi
    if [[ $count == 350 ]]; then
      args+=(--mount "type=bind,src=$plan/signed-settlement-350-profile.cjs,dst=/qualification/signed-settlement-350-profile.cjs,readonly")
    fi
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
