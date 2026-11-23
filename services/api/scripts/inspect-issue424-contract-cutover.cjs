#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const { isAbsolute, join } = require("node:path");
const { CI_DYNAMIC_MIGRATION_LABEL } = require("../prisma/local-staged-ci-dynamic.cjs");

const database = "jg424_restore_post";
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function isolatedRestore(reader, readerUrlEnv) {
  const root = process.env.DRILL_ROOT ?? "";
  requireCondition(process.env.NODE_ENV !== "production" && isAbsolute(root), "ISOLATED_RESTORE_REQUIRED");
  const drillRoot = realpathSync(root);
  const ownerPath = join(drillRoot, "container-ownership.json");
  const state = lstatSync(ownerPath);
  requireCondition(state.isFile() && (state.mode & 0o077) === 0 && state.size > 0 && state.size <= 4096,
    "ISOLATED_RESTORE_REQUIRED");
  const { runId, containerName, endpoint } = JSON.parse(readFileSync(ownerPath, "utf8"));
  requireCondition(runIdPattern.test(runId) && containerName === `jiangkong-am424-${runId}` &&
    typeof endpoint === "string" && endpoint.startsWith("unix:///"), "ISOLATED_RESTORE_REQUIRED");
  const docker = JSON.parse(execFileSync("docker", ["--host", endpoint, "inspect", "--type", "container", "--format",
    '{"name":{{json .Name}},"runId":{{json (index .Config.Labels "' + CI_DYNAMIC_MIGRATION_LABEL +
    '")}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}', containerName],
  { encoding: "utf8", timeout: 10_000, maxBuffer: 8192, stdio: ["ignore", "pipe", "pipe"] }));
  const [binding] = docker.ports?.["5432/tcp"] ?? [];
  requireCondition(docker.name === `/${containerName}` && docker.runId === runId && docker.running === true &&
    Object.keys(docker.ports ?? {}).length === 1 && docker.ports["5432/tcp"].length === 1 && binding?.HostIp === "127.0.0.1" &&
    /^\d+$/u.test(binding.HostPort), "ISOLATED_RESTORE_REQUIRED");

  const url = new URL(process.env[readerUrlEnv] ?? "");
  requireCondition(url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.port === binding.HostPort &&
    url.pathname === `/${database}` && url.username === reader && Boolean(url.password) && !url.hash &&
    [...url.searchParams].every(([key, value]) => key === "schema" && value === "public"), "ISOLATED_RESTORE_REQUIRED");
  const metrics = ["metrics-post.txt", "metrics-restore-post.txt"].map(name => {
    const path = join(drillRoot, name);
    const info = lstatSync(path);
    requireCondition(info.isFile() && info.size > 0 && info.size <= 1024 * 1024, "RESTORED_METRICS_REQUIRED");
    return readFileSync(path);
  });
  requireCondition(metrics[0].equals(metrics[1]), "RESTORED_METRICS_MISMATCH");
  const storage = join(drillRoot, "contract-signature-files");
  requireCondition(lstatSync(storage).isDirectory() && realpathSync(storage) === storage, "LOCAL_SIGNATURE_COPY_REQUIRED");
  return { url: url.href, storage };
}

async function main() {
  const args = process.argv.slice(2);
  const payment = args[0] === "--ordinary-payment";
  if (payment) args.shift();
  const reader = payment ? "jg424_payment_reader" : "jg424_contract_reader";
  const readerUrlEnv = payment ? "ISSUE424_PAYMENT_PLAN_READER_URL" : "ISSUE424_CONTRACT_PLAN_READER_URL";
  const errorPrefix = payment ? "ISSUE424_PAYMENT_CUTOVER" : "ISSUE424_CONTRACT_CUTOVER";
  if (args.length === 1 && args[0] === "--help") {
    if (payment) {
      console.log([
        "#424 普通合同付款审批回放盘点",
        "沿用合同盘点的本机恢复副本、DRILL_ROOT、恢复指标和 contract-signature-files 本地签名副本。",
        `${readerUrlEnv} 指向同一容器的 ${database}，并使用独立的 ${reader} 账号。`,
        "该账号使用默认只读事务，仅需读取 PaymentRequest、ApprovalInstance、ApprovalActionLog、HandwrittenSignatureVersion 和 FileObject。",
        "输出仅包含在途普通合同付款数、可回放数和阻断原因汇总。盘点不改变审批流程。"
      ].join("\n"));
      return;
    }
    console.log([
      "#424 历史合同审批盘点",
      "DRILL_ROOT 指向本机演练目录，目录中须有容器归属记录、两份一致的恢复指标与 contract-signature-files 本地签名副本。",
      "ISSUE424_CONTRACT_PLAN_READER_URL 指向同一容器的 jg424_restore_post，并使用 jg424_contract_reader 账号。",
      "该账号使用默认只读事务，仅需读取 ContractVersion、ApprovalInstance、ApprovalActionLog、ApprovalDelegation、HandwrittenSignatureVersion 和 FileObject。",
      "输出仅包含在途历史合同版本数、可规划数和阻断原因汇总。该命令只读盘点，切换须另行执行。"
    ].join("\n"));
    return;
  }
  let phase = "ISOLATED_RESTORE_REQUIRED";
  try {
    requireCondition(args.length === 0, phase);
    const { url, storage } = isolatedRestore(reader, readerUrlEnv);
    phase = "READ_ONLY_SESSION_REQUIRED";
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = storage;
    const { Logger } = require("@nestjs/common");
    const { PrismaClient } = require("@prisma/client");
    const { FileService, PrivateFileStorage } = require("../dist/file/file.service");
    const { AuditService } = require("../dist/audit/audit.service");
    const inspect = payment
      ? require("../dist/payment/payment-approval-cutover").inspectPendingPaymentApprovalInventory
      : require("../dist/contract/contract-approval-cutover").inspectLegacyContractApprovalInventory;
    Logger.overrideLogger(false);
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
      const [state] = await prisma.$queryRaw`
        SELECT current_database() AS database, current_user::text AS role,
          current_setting('default_transaction_read_only') AS read_only,
          NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS restricted
        FROM pg_catalog.pg_roles WHERE rolname = session_user AND session_user = current_user
      `;
      requireCondition(state?.database === database && state.role === reader && state.read_only === "on" && state.restricted, phase);
      phase = "INVENTORY_UNAVAILABLE";
      const privateStorage = new PrivateFileStorage();
      privateStorage.assertConfigured();
      const report = await inspect(prisma, new FileService(prisma, new AuditService(), privateStorage));
      console.log(JSON.stringify(report));
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    const detail = ["RESTORED_METRICS_REQUIRED", "RESTORED_METRICS_MISMATCH", "LOCAL_SIGNATURE_COPY_REQUIRED"].includes(error?.message)
      ? error.message : phase;
    console.error(`${errorPrefix}_${detail}`);
    process.exitCode = 1;
  }
}

void main();
