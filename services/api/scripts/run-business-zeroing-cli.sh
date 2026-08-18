#!/bin/sh
set -eu

if [ -n "${NODE_OPTIONS-}" ]; then
  echo "归零工具启动器拒绝 NODE_OPTIONS：未指纹预加载不得在 Node 启动前执行" >&2
  exit 64
fi
if [ -n "${NODE_PATH-}" ]; then
  echo "归零工具启动器拒绝 NODE_PATH：仓库外模块路径不得生效" >&2
  exit 64
fi

command_name=${1-}
if [ -z "$command_name" ]; then
  echo "用法：run-business-zeroing-cli.sh <inspect|execute|verify|sign|dynamic> [参数]" >&2
  exit 64
fi
shift

case "$command_name" in
  inspect|execute|verify|sign|dynamic) ;;
  *)
    echo "归零工具启动器不支持命令：$command_name" >&2
    exit 64
    ;;
esac

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
unset NODE_OPTIONS NODE_PATH
capability_file=$(mktemp "${TMPDIR:-/tmp}/pol22-launch-capability.XXXXXX")
trap 'rm -f "$capability_file"' EXIT HUP INT TERM
chmod 600 "$capability_file"
printf '%s\n' "$$:$script_directory/run-business-zeroing-cli.sh" >"$capability_file"
POL22_LAUNCHER_PARENT_PID=$$ POL22_LAUNCHER_CAPABILITY_FD=9 \
POL22_LAUNCHER_CAPABILITY_PATH="$capability_file" \
  node "$script_directory/business-zeroing-cli.cjs" "$command_name" "$@" 9<"$capability_file"
