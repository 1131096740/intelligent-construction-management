#!/usr/bin/env bash
set -euo pipefail
umask 077

# This is a single diagnostic run on a dedicated native GitHub runner.
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux && "${RUNNER_ARCH:-}" == X64 &&
   "${GITHUB_REF:-}" == refs/heads/codex/pr348-historical-evidence-20261024 ]] || exit 20
pr348_source="$(realpath "$1")"
pr348_control="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
pr348_sha=6ec31b9fabe9cfc4a91215c1476b773bb7d32224
[[ "$(git -C "$pr348_source" rev-parse HEAD)" == "$pr348_sha" &&
   "$(git -C "$pr348_control" rev-parse HEAD)" == "${PR348_CONTROL_SHA:-}" &&
   "$(git -C "$pr348_source" status --porcelain=v1 --untracked-files=no)" == '' ]] || exit 20
pr348_private="$(mktemp -d "$RUNNER_TEMP/pr348-historical-private.XXXXXX")"
pr348_safe="$RUNNER_TEMP/pr348-historical-safe"
mkdir -m 700 "$pr348_safe"
pr348_phase=dependency_preparation
pr348_code=null
pr348_log="$pr348_private/preparation.private.log"
touch "$pr348_log"
chmod 600 "$pr348_log"
pr348_exit() {
  if [[ ! -f "$pr348_safe/result.json" ]]; then
    printf '{"status":"environment_failed_or_incomplete","phase":"%s","originalChildExitCode":%s,"historicalRootCauseProven":false}\n' "$pr348_phase" "$pr348_code" > "$pr348_safe/result.json"
    chmod 600 "$pr348_safe/result.json"
    cat "$pr348_safe/result.json"
  fi
}
trap pr348_exit EXIT

[[ "$(node --version)" == v20.20.2 ]] || exit 20
export COREPACK_HOME="$pr348_private/corepack"
export PLAYWRIGHT_BROWSERS_PATH="$pr348_private/browsers"
corepack enable >> "$pr348_log" 2>&1
corepack prepare pnpm@9.15.9 --activate >> "$pr348_log" 2>&1
[[ "$(pnpm --version)" == 9.15.9 &&
   "$(sha256sum "$pr348_source/pnpm-lock.yaml" | cut -d' ' -f1)" == 0d86a063b957d98d1f1f3e81f74a8bceb00be405737631a10a21c283042f3f2b ]] || exit 20
CI=true pnpm --dir "$pr348_source" install --frozen-lockfile >> "$pr348_log" 2>&1
pnpm --dir "$pr348_source" --filter @jiangkong/api exec prisma generate >> "$pr348_log" 2>&1
pr348_cli="$(node - "$pr348_source" 2>> "$pr348_log" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
try {
 const root=process.argv[2],web=createRequire(path.join(root,'apps/web-admin/package.json'));
 const test=web.resolve('@playwright/test/package.json'),pw=createRequire(test).resolve('playwright/package.json');
 const core=createRequire(pw).resolve('playwright-core/package.json'),directory=path.dirname(core);
 if(JSON.parse(fs.readFileSync(core,'utf8')).version!=='1.64.0')throw new Error();
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,'browsers.json'))).digest('hex');
 if(hash!=='2cfd419f71ac6475d81e1301fa86c34cf2a2a6bae2a0da4b5a2b18310216b6bf')throw new Error();
 process.stdout.write(path.join(directory,'cli.js'));
}catch{process.stderr.write('historical runtime metadata rejected\n');process.exitCode=20;}
JS
)"
pr348_phase=host_prefix
python3 "$pr348_control/scripts/ci/pr348-glib9-prefix.py" --private-root "$pr348_private/host" \
  --node "$(command -v node)" --playwright-cli "$pr348_cli"
pr348_phase=browser_preparation
node "$pr348_cli" install chromium webkit >> "$pr348_log" 2>&1
node - "$pr348_source" "$PLAYWRIGHT_BROWSERS_PATH" >> "$pr348_log" 2>&1 <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
try {
 const source=process.argv[2],browser=process.argv[3],api=createRequire(path.join(source,'services/api/package.json'));
 const client=api.resolve('@prisma/client/package.json'),generated=path.dirname(createRequire(client).resolve('.prisma/client/package.json'));
 if(JSON.parse(fs.readFileSync(client,'utf8')).version!=='5.22.0')throw new Error();
 const pins=[
  [path.join(generated,'schema.prisma'),'445af160f911eb37a6b892ee41bcdecb0cd1a7bf7f9ae50c3d27fca3d0416da8'],
  [path.join(browser,'chromium-1248/chrome-linux64/chrome'),'377a9fc07b495c3b8d0ab8ec1fdfd153641759f9756fea34d8dfce4de82f5025'],
  [path.join(browser,'chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'),'4fa61f0ba0b4f89b7bec242c32ca16d3bccf69dbfef0651924a9ba8fede5f9d6'],
  [path.join(browser,'webkit-2370/pw_run.sh'),'a85baad3d8c07173ac387a59b41500c382b21ed692afe0964d29aac247ccc63b'],
  [path.join(browser,'webkit-2370/minibrowser-wpe/bin/MiniBrowser'),'cabd927f18f32bc22280fc5f730b84d035dd2bfb71cb53fad3ed1c3e2f3de5ef']
 ];
 for(const [file,expected]of pins)if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw new Error();
}catch{process.stderr.write('historical generated client or browser pins rejected\n');process.exitCode=20;}
JS
pr348_phase=postgres_preparation
pr348_image=postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d
docker pull --platform linux/amd64 "$pr348_image" >> "$pr348_log" 2>&1
[[ "$(docker image inspect --format '{{.Os}} {{.Architecture}}' "$pr348_image")" == 'linux amd64' ]] || exit 20
docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$pr348_image" | grep -Fxq 'PG_VERSION=16.15-1.pgdg13+2'
pr348_round="$(mktemp -d "$pr348_private/round.XXXXXX")"
node "$pr348_control/scripts/ci/pr348-historical-prepare-runner.cjs" "$pr348_source" "$pr348_round"
mkdir -m 700 "$pr348_round/tmp" "$pr348_round/collector-root"
if [[ -e "$pr348_source/apps/web-admin/test-results" || -L "$pr348_source/apps/web-admin/test-results" ]]; then
  [[ ! -L "$pr348_source/apps/web-admin/test-results" ]] || exit 20
  mv "$pr348_source/apps/web-admin/test-results" "$pr348_round/preexisting-output-original"
fi
pr348_phase=original22
pr348_code=0
env -i PATH="$PATH" HOME="$HOME" COREPACK_HOME="$COREPACK_HOME" CI=true NODE_ENV=test LANG=C.UTF-8 \
  TMPDIR="$pr348_round/tmp" PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" \
  PR348_NATIVE_SOURCE="$pr348_source" PR348_NATIVE_ROUND="$pr348_round" \
  node "$pr348_round/launch.cjs" > "$pr348_round/runner.stdout.private.log" 2> "$pr348_round/runner.stderr.private.log" || pr348_code=$?
chmod 600 "$pr348_round/runner.stdout.private.log" "$pr348_round/runner.stderr.private.log"
pr348_phase=metadata_projection
(cd "$pr348_round/collector-root" && python3 "$pr348_control/scripts/ci/collect-roster-failure-diagnostics.py" --output "$pr348_safe/summary.json")
pr348_phase=final_result
node - "$pr348_source" "$pr348_round" "$pr348_code" "$pr348_safe/result.json" <<'JS'
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const [source,round,code,output]=process.argv.slice(2);let result;
try {
 const rows=['onboarding','roster'].map(s=>JSON.parse(fs.readFileSync(path.join(round,'suite-browser-artifacts',s+'.safe.json'),'utf8')));
 const sourceClean=cp.spawnSync('git',['-C',source,'diff','--quiet','HEAD','--']).status===0;
 const cleanupReported=/EMPLOYEE_ONBOARDING 已清理自身容器：jiangkong-onboarding-http-[a-f0-9-]+/.test(fs.readFileSync(path.join(round,'runner.stdout.private.log'),'utf8'));
 const counts=rows.map(r=>({suite:r.suite,registered:r.registered,passed:r.passed,failed:r.failed,skipped:r.skipped,capture:r.status}));
 const passed=Number(code)===0&&sourceClean&&cleanupReported&&rows.every((r,i)=>r.registered===[12,10][i]&&r.passed===r.registered&&r.failed===0&&r.skipped===0&&r.status==='captured');
 result={status:passed?'diagnostic_original22_passed':'diagnostic_incomplete_or_failed',sourceSha:'6ec31b9fabe9cfc4a91215c1476b773bb7d32224',originalChildExitCode:Number(code),sourceClean,cleanupReported,counts,
  runtime:{node:process.versions.node,pnpm:'9.15.9',postgres:'16.15-1.pgdg13+2',playwright:'1.64.0',chromium:1248,webkit:2370},historicalRootCauseProven:false};
}catch{result={status:'diagnostic_incomplete_or_failed',originalChildExitCode:Number(code),historicalRootCauseProven:false};}
fs.writeFileSync(output,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));process.exitCode=result.status==='diagnostic_original22_passed'?0:1;
JS
