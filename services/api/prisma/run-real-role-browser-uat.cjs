const path = require("node:path");
const fs = require("node:fs");
const { createCommandRuntime } = require("./money-bigint-runner-runtime.cjs");

const root = path.resolve(__dirname, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { command } = createCommandRuntime({ defaultCwd: root });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const apiBaseUrl = process.env.API_BASE_URL || "";
  const password = process.env.TRIAL_RUN_PASSWORD || "";
  const candidateSha = process.env.TRIAL_RUN_CANDIDATE_SHA || "";
  const evidencePath = process.env.REAL_BROWSER_EVIDENCE_PATH || "";
  assert(/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(apiBaseUrl), "真实岗位浏览器 UAT 只允许本机 API");
  assert(password.length >= 8, "真实岗位浏览器 UAT 缺少隔离账号密码");
  assert(/^[0-9a-f]{40}$/.test(candidateSha), "真实岗位浏览器 UAT 缺少 40 位候选 SHA");
  assert(path.isAbsolute(evidencePath), "真实岗位浏览器 UAT 证据路径必须是绝对路径");
  assert(evidencePath.endsWith(".json"), "真实岗位浏览器 UAT 证据路径必须以 .json 结尾");

  await command(pnpm, ["--filter", "@jiangkong/web-admin", "test:e2e:rc06:real"], {
    cwd: root,
    env: {
      ...process.env,
      REAL_API_BASE_URL: apiBaseUrl,
      REAL_ROLE_PASSWORD: password,
      REAL_BROWSER_CANDIDATE_SHA: candidateSha,
      REAL_BROWSER_EVIDENCE_PATH: path.resolve(evidencePath),
      REAL_BROWSER_OUTPUT_DIR: path.resolve(`${evidencePath}.artifacts`)
    },
    forwardOutput: true,
    timeoutMs: 30 * 60 * 1000
  });
  const evidenceFiles = [
    `${evidencePath.replace(/\.json$/u, "")}-rc06-real-chromium-1366x768.json`,
    `${evidencePath.replace(/\.json$/u, "")}-rc06-real-webkit-390x844.json`
  ];
  for (const file of evidenceFiles) {
    assert(fs.existsSync(file), `缺少真实岗位浏览器证据：${file}`);
    const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
    assert(evidence.status === "passed", `真实岗位浏览器证据未通过：${file}`);
    assert(evidence.candidateSha === candidateSha, `真实岗位浏览器证据 SHA 不一致：${file}`);
    for (const status of ["400", "403", "409"]) {
      assert(Number(evidence.requestStatusCounts?.[status] ?? 0) > 0, `真实岗位浏览器证据缺少 HTTP ${status}：${file}`);
    }
    fs.chmodSync(file, 0o600);
  }
  console.log(`RC-06 真实岗位 API-backed 浏览器门通过；候选 ${candidateSha}；证据 ${path.resolve(evidencePath)}-*`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { main };
