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
  inspect) entrypoint=inspect-test-business-zeroing.cjs ;;
  execute) entrypoint=execute-test-business-zeroing.cjs ;;
  verify) entrypoint=verify-test-business-zeroing.cjs ;;
  sign) entrypoint=sign-business-zeroing-input.cjs ;;
  dynamic) entrypoint=../prisma/run-business-zeroing-local.cjs ;;
  *)
    echo "归零工具启动器不支持命令：$command_name" >&2
    exit 64
    ;;
esac

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
unset NODE_OPTIONS NODE_PATH
exec node - "$script_directory/$entrypoint" "$script_directory/business-zeroing-cli.cjs" "$@" <<'NODE'
"use strict";

const entrypoint = process.argv[2];
const cliLibrary = process.argv[3];
const argv = process.argv.slice(4);

const { runTrustedCommand } = require(cliLibrary);

const command = require(entrypoint);
Promise.resolve(runTrustedCommand(command, { entrypoint, argv })).catch((error) => {
  process.stderr.write(
    `归零工具受信启动器已安全阻断：${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
NODE
