const path = require("node:path");
const fs = require("node:fs");
const { createCommandRuntime } = require("./money-bigint-runner-runtime.cjs");

const root = path.resolve(__dirname, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { command } = createCommandRuntime({ defaultCwd: root });
const contractIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function evidenceFilesFor(evidencePath) {
  const prefix = evidencePath.replace(/\.json$/u, "");
  return [
    `${prefix}-rc06-real-chromium-1366x768.json`,
    `${prefix}-rc06-real-webkit-390x844.json`
  ];
}

function writeEvidence(file, evidence) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function resolveSelfArchiveContractId({ governanceEvidencePath, runId, candidateSha }) {
  assert(path.isAbsolute(governanceEvidencePath), "真实岗位浏览器 UAT 缺少绝对治理证据路径");
  let governance;
  try {
    governance = JSON.parse(fs.readFileSync(governanceEvidencePath, "utf8"));
  } catch {
    throw new Error("真实岗位浏览器 UAT 无法读取治理证据");
  }
  assert(governance?.runId === runId, "真实岗位浏览器 UAT 治理证据 runId 不一致");
  assert(governance?.candidateSha === candidateSha, "真实岗位浏览器 UAT 治理证据 SHA 不一致");
  const selfArchiveCase = governance?.cases?.find(
    (item) => item?.id === "contract_director_handler_self_archive"
  );
  assert(selfArchiveCase?.passed === true, "真实岗位浏览器 UAT 自归档治理用例未通过");
  const evidenceId = selfArchiveCase?.evidenceIds?.[0];
  const prefix = `${runId}:`;
  assert(typeof evidenceId === "string" && evidenceId.startsWith(prefix), "真实岗位浏览器 UAT 自归档证据 runId 不一致");
  const contractId = evidenceId.slice(prefix.length);
  assert(contractIdPattern.test(contractId), "真实岗位浏览器 UAT 自归档证据缺少合同 UUID");
  return contractId;
}

function writeFailedBrowserEvidence({ evidenceFiles, candidateSha }) {
  for (const file of evidenceFiles) {
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      // A crashed worker may not have produced a receipt; the runner writes one below.
    }
    writeEvidence(file, {
      ...existing,
      schemaVersion: 1,
      gate: "rc06-real-api-backed-browser",
      status: "failed",
      candidateSha,
      testFailures: ["runner:playwright_test_failed"]
    });
  }
}

function finalizeBrowserEvidence({ evidenceFiles, candidateSha }) {
  for (const file of evidenceFiles) {
    assert(fs.existsSync(file), `缺少真实岗位浏览器证据：${file}`);
    const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
    assert(evidence.status === "pending", `真实岗位浏览器证据未通过：${file}`);
    assert(evidence.candidateSha === candidateSha, `真实岗位浏览器证据 SHA 不一致：${file}`);
    assert(
      (evidence.browserErrors ?? []).length === 0 &&
        (evidence.failedRequests ?? []).length === 0 &&
        (evidence.testFailures ?? []).length === 0,
      `真实岗位浏览器证据未通过：${file}`
    );
    for (const status of ["400", "403", "409", "503"]) {
      assert(Number(evidence.requestStatusCounts?.[status] ?? 0) > 0, `真实岗位浏览器证据缺少 HTTP ${status}：${file}`);
    }
    writeEvidence(file, { ...evidence, status: "passed" });
  }
}

async function main() {
  const apiBaseUrl = process.env.API_BASE_URL || "";
  const password = process.env.TRIAL_RUN_PASSWORD || "";
  const candidateSha = process.env.TRIAL_RUN_CANDIDATE_SHA || "";
  const evidencePath = process.env.REAL_BROWSER_EVIDENCE_PATH || "";
  const governanceEvidencePath = process.env.TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH || "";
  const runId = process.env.TRIAL_RUN_ID || "";
  assert(/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(apiBaseUrl), "真实岗位浏览器 UAT 只允许本机 API");
  assert(password.length >= 8, "真实岗位浏览器 UAT 缺少隔离账号密码");
  assert(/^[0-9a-f]{40}$/.test(candidateSha), "真实岗位浏览器 UAT 缺少 40 位候选 SHA");
  assert(path.isAbsolute(evidencePath), "真实岗位浏览器 UAT 证据路径必须是绝对路径");
  assert(evidencePath.endsWith(".json"), "真实岗位浏览器 UAT 证据路径必须以 .json 结尾");
  const selfArchiveContractId = resolveSelfArchiveContractId({
    governanceEvidencePath,
    runId,
    candidateSha
  });
  const freezeApiBaseUrl = process.env.REAL_FREEZE_API_BASE_URL || "";
  assert(/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(freezeApiBaseUrl), "真实岗位浏览器 UAT 缺少本机写冻结 API");
  const evidenceFiles = evidenceFilesFor(evidencePath);

  try {
    await command(pnpm, ["--filter", "@jiangkong/web-admin", "test:e2e:rc06:real"], {
      cwd: root,
      env: {
        ...process.env,
        REAL_API_BASE_URL: apiBaseUrl,
        REAL_FREEZE_API_BASE_URL: freezeApiBaseUrl,
        REAL_ROLE_PASSWORD: password,
        REAL_BROWSER_CANDIDATE_SHA: candidateSha,
        REAL_BROWSER_EVIDENCE_PATH: path.resolve(evidencePath),
        REAL_BROWSER_OUTPUT_DIR: path.resolve(`${evidencePath}.artifacts`),
        REAL_BROWSER_SELF_ARCHIVE_CONTRACT_ID: selfArchiveContractId
      },
      forwardOutput: true,
      timeoutMs: 30 * 60 * 1000
    });
    finalizeBrowserEvidence({ evidenceFiles, candidateSha });
  } catch (error) {
    writeFailedBrowserEvidence({ evidenceFiles, candidateSha });
    throw error;
  }
  console.log(`RC-06 真实岗位 API-backed 浏览器门通过；候选 ${candidateSha}；证据 ${path.resolve(evidencePath)}-*`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  evidenceFilesFor,
  finalizeBrowserEvidence,
  main,
  resolveSelfArchiveContractId,
  writeFailedBrowserEvidence
};
