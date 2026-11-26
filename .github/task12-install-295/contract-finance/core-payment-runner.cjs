"use strict";

const { spawnSync } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const profiles = Object.freeze({
  core: {
    flags: ["RUN_POL114_HTTP_PG16", "RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16",
      "RUN_POL114_PAYMENT_HTTP_PG16", "RUN_COMPANY_TRANSFER_HTTP"],
    specs: [["contract-business-entry-http.spec.ts", 1, "合同现役提交与旧入口退出：aggregate"],
      ["company-transfer-http-postgres.spec.ts", 1]],
  },
  payment: {
    flags: ["RUN_PAYMENT_EXECUTION_CONCURRENCY"],
    specs: [["payment-execution-concurrency.spec.ts", 2]],
  },
});

async function verify(scope, context, ledgerCount = 295, settlementReadKey) {
  if (![295, 329, 330, 331, 332, 334, 346].includes(ledgerCount)) throw new Error("CONTRACT_FINANCE_LEDGER");
  const profile = Object.hasOwn(profiles, scope) ? profiles[scope] : undefined;
  if (!profile || (ledgerCount === 346 && scope !== "core")) throw new Error("CONTRACT_FINANCE_MODE");
  const storage = path.join(context.workDir, "contract-finance-files");
  mkdirSync(storage, { mode: 0o700 });
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: context.workDir, TMPDIR: context.workDir,
    COREPACK_HOME: "/opt/corepack", COREPACK_ENABLE_NETWORK: "0", COREPACK_DEFAULT_TO_LATEST: "0",
    NODE_ENV: "test", CI: "true", DATABASE_URL: context.ownerUrl,
    FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: storage, SMS_ENABLED: "false",
    INITIAL_USER_TEMPORARY_PASSWORD: "Local-Transfer-Initial-01",
    OPERATING_LEDGER_DB_WRITE_SECRET: randomUUID(),
    JG_TASK12_OWNED_280_RUN_ID: context.runId, JG_CONTRACT_FINANCE_SCOPE: scope,
    ...(ledgerCount !== 295 ? {JG_CONTRACT_FINANCE_LEDGER: String(ledgerCount)} : {}),
    ...(settlementReadKey ? {SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY: settlementReadKey} : {}),
    ...Object.fromEntries(profile.flags.map(flag=>[flag,"1"])),
  };
  const suites = [];
  const browserObservation = path.join(context.workDir, "company-transfer-browser-observation.jsonl");
  const readBrowserObservation = () => existsSync(browserObservation)
    ? readFileSync(browserObservation,"utf8").trim().split("\n").slice(0,6).map(line => JSON.parse(line))
    : [];
  function command(stage, args) {
    const result = spawnSync("pnpm", ["--filter", "@jiangkong/api", "exec", ...args], {
      cwd: "/qualification/workspace", env, encoding: "utf8", timeout: 300_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0 || result.error) {
      const report = args[args.indexOf("--outputFile") + 1];
      const summary = args.includes("--outputFile") && report && existsSync(report)
        ? JSON.parse(readFileSync(report, "utf8")) : undefined;
      const first = summary?.testResults?.[0]?.assertionResults?.find(test=>test.status==="failed");
      const message = first?.failureMessages?.[0] ?? result.stderr ?? "";
      const denial = /permission denied for (table|function|schema|relation) ([A-Za-z0-9_."]{1,100})/u.exec(message);
      throw Object.assign(new Error(stage), {
        approvals: readApprovalObservations?.(), paymentCapabilities: readPaymentObservations?.(), completedSuites: [...suites], browserObservation: readBrowserObservation(),
        historicalContract: readHistoricalContract(),
        exit: result.status, signal: result.signal, executionError: result.error?.code,
        sqlstate: /\b(?:code|SQLSTATE)\W+([0-9A-Z]{5})\b/u.exec(message)?.[1],
        prismaCode: /\bP[0-9]{4}\b/u.exec(message)?.[0],
        denied: denial ? { kind: denial[1], object: denial[2] } : undefined,
        failedTest: first ? createHash("sha256").update(first.fullName).digest("hex") : undefined,
        passed: summary?.numPassedTests,
        diagnostic: (() => {
          const clean = message.replace(/\x1b\[[0-9;]*m/gu, "");
          const frames = [...clean.matchAll(/(?:contract-business-entry-http\.spec\.ts|company-transfer-http-postgres\.spec\.ts|approval-pdf-acceptance\.test-support\.ts):(\d+):(\d+)/gu)];
          const contractChainLine = /company-transfer-contract-acceptance\.ts:(\d+):\d+/u.exec(clean)?.[1];
          const failedRequest = /\b([a-z_]+) (\/[^\s]*): ([1-5][0-9]{2}) (\{[^\n]*\})/u.exec(clean);
          const knownGroups = /\/(affiliate-contract-facts|affiliate-company-contracts|affiliate-settlement-facts|contract-proxy-executions|fund-executions|contract-bank-verifications|upward-receipt-matches|contract-relationship-ledger)(?:[/?]|$)/u;
          const exactStatus = /(?:状态码\s+|POST \/contracts\/[^/\s]+\/approval: |\b(?:upload|[a-z_]+ \/[^\s]+:) )([1-5][0-9]{2})/u.exec(clean)?.[1];
          const signedResponse = /\bPOL114_SIGNED_SETTLEMENT_HTTP_([1-5][0-9]{2})_(UNCLASSIFIED|OPERATIONAL_WRITE_FREEZE_ACTIVE|OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED|OLD_WRITE_ENTRY_RETIRED)\b/u.exec(clean);
          const reviewOutcomes = /POL114_SIGNED_SETTLEMENT_REVIEW_OUTCOMES ([A-Z0-9_ ]{1,165}) \| ([A-Z0-9_ ]{1,165})/u.exec(clean);
          const signedQuery = /\bPOL114_SIGNED_SETTLEMENT_QUERY_([0-9A-Z]{5}|EADDRINUSE|EACCES|ECONNREFUSED|UNCLASSIFIED)\b/u.exec(clean)?.[1];
          const expected = /Expected:\s+([1-5][0-9]{2})/u.exec(clean)?.[1];
          const received = /Received:\s+([1-5][0-9]{2})/u.exec(clean)?.[1];
          const moduleMissing = /Cannot find module|MODULE_NOT_FOUND/u.test(clean);
          const assertion = /expect\(received\)|AssertionError/u.test(clean);
          return {
            frames: frames.slice(0,4).map(frame=>[Number(frame[1]),Number(frame[2])]),
            contractChainLine: contractChainLine ? Number(contractChainLine) : undefined,
            requestGroup: failedRequest ? knownGroups.exec(failedRequest[2])?.[1] : undefined,
            responseFingerprint: failedRequest ? createHash("sha256").update(failedRequest[4]).digest("hex") : undefined,
            status: exactStatus ? Number(exactStatus) : undefined,
            reviewOutcomes: reviewOutcomes?.slice(1).map(outcome => outcome.trim()),
            signedSettlement: signedResponse ? { status: Number(signedResponse[1]), code: signedResponse[2], query: signedQuery } : undefined,
            expected: expected ? Number(expected) : undefined,
            received: received ? Number(received) : undefined,
            kind: moduleMissing ? "MODULE_NOT_FOUND" : assertion ? "ASSERTION" : /Timeout|timeout/u.test(clean) ? "TIMEOUT" : "OTHER",
          };
        })(),
      });
    }
    return result.stdout;
  }
  const historicalContractObservation = path.join(context.workDir, "core-historical-contract.json");
  const readHistoricalContract = () => existsSync(historicalContractObservation)
    ? JSON.parse(readFileSync(historicalContractObservation, "utf8"))
    : undefined;
  let readApprovalObservations, readPaymentObservations;
  if (scope === "core") {
    const owner = new URL(context.ownerUrl);
    if (owner.searchParams.get("connection_limit") !== "1") throw new Error("CONTRACT_FINANCE_CORE_POOL_PREIMAGE");
    owner.searchParams.set("connection_limit", "2");
    env.DATABASE_URL = owner.toString();
    env.COMPANY_TRANSFER_CORE_RECEIPT = path.join(context.workDir, "core-fixture.json");
    env.RUN_POL114_CORE_APPROVAL_OBSERVER = "1";
    env.POL114_CORE_APPROVAL_OBSERVATION = path.join(context.workDir, "core-approval-observations.jsonl");
    env.POL114_CORE_PAYMENT_OBSERVATION = path.join(context.workDir, "core-payment-observations.jsonl");
    if (ledgerCount !== 295) env.POL114_CORE_HISTORICAL_CONTRACT_OBSERVATION = historicalContractObservation;
    readPaymentObservations = () => existsSync(env.POL114_CORE_PAYMENT_OBSERVATION)
      ? readFileSync(env.POL114_CORE_PAYMENT_OBSERVATION, "utf8").trim().split("\n").slice(0,8).map(line => JSON.parse(line))
      : [];
    readApprovalObservations = () => existsSync(env.POL114_CORE_APPROVAL_OBSERVATION)
      ? readFileSync(env.POL114_CORE_APPROVAL_OBSERVATION, "utf8").trim().split("\n").slice(0,40).map(line => JSON.parse(line))
      : [];
  }

  for (const [file, count, pattern] of profile.specs) {
    if (scope === "core" && file === "company-transfer-http-postgres.spec.ts") {
      if (!existsSync(env.COMPANY_TRANSFER_CORE_RECEIPT)) throw new Error("CONTRACT_FINANCE_CORE_HANDOFF_MISSING");
      env.COMPANY_TRANSFER_OWNED_WEB_ROOT = require("./contract-finance-stage-web.cjs").stageCompanyTransferWeb(context.workDir);
      env.COMPANY_TRANSFER_BROWSER_OBSERVATION = browserObservation;
      env.PLAYWRIGHT_BROWSERS_PATH = "/opt/jg-playwright";
      env.XDG_CACHE_HOME = path.join(context.workDir, "browser-cache");
      mkdirSync(env.XDG_CACHE_HOME,{mode:0o700});
    }
    const report = path.join(context.workDir, file + ".json");
    const spec = "src/database/" + file;
    command("CONTRACT_FINANCE_" + file.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "_"), [
      "jest", "--runInBand", "--runTestsByPath", spec,
      ...(pattern ? ["--testNamePattern", pattern] : []),
      "--json", "--outputFile", report,
    ]);
    const jest = JSON.parse(readFileSync(report, "utf8"));
    if (!jest.success || jest.numPassedTestSuites !== 1 || jest.numPassedTests !== count ||
        (!pattern && jest.numPendingTests !== 0) || !jest.testResults[0]?.name.endsWith("/" + spec)) {
      throw new Error("CONTRACT_FINANCE_COVERAGE_MISMATCH");
    }
    suites.push({ file: spec, passed: count, skipped: jest.numPendingTests });
  }
  return {scope,suites,...(scope==="core"?{poolCapacity:2,approvals:readApprovalObservations(),
    paymentCapabilities:readPaymentObservations(),historicalContract:readHistoricalContract(),browserObservation:readBrowserObservation()}: {})};
}

module.exports={verify};
