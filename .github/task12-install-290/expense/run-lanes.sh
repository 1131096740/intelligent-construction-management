#!/bin/bash
set -euo pipefail
[[ $# == 4 ]]
lane=$1
image=$2
product=$3
material=$4
case "$lane" in execution|finance|receipt) ;; *) exit 2 ;; esac
modes=(app valid negative)
if [[ $lane != receipt ]]; then modes+=(recovery); fi
for mode in "${modes[@]}"; do
  dir="$material/$mode"
  args=(--platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL
    --security-opt no-new-privileges --user postgres --init --pids-limit 256 --memory 4g
    --tmpfs /tmp:rw,noexec,nosuid,size=512m
    --mount "type=bind,src=$product,dst=/qualification/product,readonly"
    --mount "type=bind,src=$dir/installer.cjs,dst=/qualification/installer.cjs,readonly"
    --mount "type=bind,src=$dir/entry.cjs,dst=/qualification/install-only.cjs,readonly")
  case "$mode" in
    app)
      case "$lane" in
        execution|finance) spec="project-expense-$lane-concurrency.owned282.spec.ts" ;;
        receipt) spec=project-expense-receipt-concurrency.spec.ts ;;
      esac
      args+=(--mount "type=bind,src=$dir/$lane/$spec,dst=/qualification/workspace/services/api/src/database/$spec,readonly")
      mounts=(expense-app.cjs profiles.json)
      ;;
    valid)
      mounts=(task12-expense-execution-retained-valid.json task12-expense-finance-retained-valid.json task12-expense-receipt-retained-seed.json)
      ;;
    negative)
      mounts=(task12-expense-execution-retained-negative.cjs task12-expense-execution-retained-negative.json
        task12-expense-finance-retained-negative.cjs task12-expense-finance-retained-negative.json receipt-negative.cjs receipt-seed.cjs)
      ;;
    recovery)
      mounts=("task12-expense-$lane-recovery.cjs" "task12-expense-$lane-recovery.json")
      ;;
  esac
  for file in "${mounts[@]}"; do
    args+=(--mount "type=bind,src=$dir/$file,dst=/qualification/$file,readonly")
  done
  docker run "${args[@]}" --entrypoint node "$image" /qualification/install-only.cjs "$lane"
done
