#!/bin/bash
set -euo pipefail
umask 022
[[ $# == 5 && $1 == task398_browser_completion ]] || exit 64
root=$2
ref=$3
partial=$4
output=$5
here=$(cd "$(dirname "$0")" && pwd -P)
[[ ! -e "$output" && ! -L "$output" ]] || exit 64
(cd "$here" && shasum -a 256 -c plan.sha256 >/dev/null)
bash "$partial/prepare.sh" "$root" "$ref" "$output"
python3 "$here/assemble.py" "$output/context"
printf '%s\n' 'LABEL org.jiangkong.ci.group="task398_browser_completion"' >> "$output/context/Dockerfile"

node --check "$output/context/installer.cjs"
node --check "$output/context/install-only.cjs"
node --check "$output/context/workspace/services/api/prisma/run-task398-shared-standard-local.cjs"
