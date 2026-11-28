"use strict";

// Fake process ports for the public PFQ CLI regression. No database is opened.
const fs = require("node:fs");
const path = require("node:path");
const statePath = path.join(__dirname, "../state.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
const event = { tool, args: args.includes("-c") ? [...args.slice(0, args.indexOf("-c") + 1), "<SQL>"] : args };
event.applicationName = tool === "pnpm" ? new URL(process.env.DATABASE_URL).searchParams.get("application_name") :
  args.find(value => value.startsWith("PGAPPNAME="))?.slice("PGAPPNAME=".length) ?? "psql";
let stdout = "";
let stderr = "";
let exitCode = 0;
const fail = message => { stderr = message; exitCode = 1; };
const row = index => state.migrations[index];
const database = name => state.databases[name] ??= { applied: 0,
  oid: String(16384 + Object.keys(state.databases).length), failed: false, resolved: false, remediated: false };
const ledger = db => [...state.migrations.slice(0, db.applied).map(item => ({ ...item, finished: true, rolledBack: false })),
  ...(db.failed ? [{ ...row(114), finished: false, rolledBack: db.resolved }] : [])]
  .sort((left, right) => left.name.localeCompare(right.name));
const inspectDatabase = (name, db) => ({ database: name, databaseOid: db.oid, namespaceOid: "2200",
  actorOid: "10", ownerOid: "10", actor: "jiangkong", sessionActor: "jiangkong",
  systemIdentifier: "1234567890123456789", version: 160015, encoding: "UTF8", replication: "origin",
  roles: state.roles, ledger: ledger(db) });
const inert = (name, oid) => ({ name, oid: String(oid), superuser: false, createRole: false,
  createDb: false, replication: false, bypassRls: false, memberships: [] });

if (tool === "pnpm") {
  if (args.includes("test")) event.action = "business-tests";
  else {
    const url = new URL(process.env.DATABASE_URL);
    const name = url.pathname.slice(1);
    const db = database(name);
    event.database = name;
    if (args.includes("resolve")) {
      event.action = "resolve";
      if (!db.failed || !db.remediated || db.resolved) fail("invalid explicit resolve");
      else db.resolved = true;
    } else if (args.includes("status")) stdout = "Database schema is up to date!";
    else {
      const schema = args.includes("--schema") ? args[args.indexOf("--schema") + 1] : path.join(state.prismaRoot, "schema.prisma");
      const count = fs.readdirSync(path.join(path.dirname(schema), "migrations"), { withFileTypes: true })
        .filter(item => item.isDirectory()).length;
      event.action = "deploy";
      event.count = count;
      const negative = /pre115_(duplicate|cross_business|replacement_child|replacement_parent)$/u.test(name);
      if (count === 203 && db.applied === 114 && negative && !db.failed) {
        db.failed = true;
        db.reason = name.endsWith("duplicate") ? "project_financing_quota_duplicate_attachment" :
          "project_financing_quota_cross_business_attachment";
        state.serverLog += "ERROR: " + (state.retainExpectedReason ? db.reason : "unknown_failure") + "\n";
        event.action = "masked-failure";
        fail("ERROR: current transaction is aborted, commands ignored until end of transaction block");
      } else {
        const previous = db.applied;
        db.applied = count;
        if (count >= 203) {
          for (const [index, roleName] of state.legacyNames.entries()) {
            if (!state.roles.some(role => role.name === roleName)) state.roles.push(inert(roleName, 20001 + index));
          }
        }
        stdout = previous === count ? "No pending migrations to apply." :
          state.migrations.slice(previous, count).map(item => "Applying migration " + item.name).join("\n");
      }
    }
  }
} else if (args[0] === "context") stdout = JSON.stringify("unix:///tmp/fake-pfq.sock");
else if (args[0] === "run") {
  state.containerName = args[args.indexOf("--name") + 1];
  state.runId = args[args.indexOf("--label") + 1].split("=")[1];
  state.port = args[args.indexOf("--publish") + 1].split(":")[1];
  stdout = "a".repeat(64);
} else if (args[0] === "inspect") stdout = JSON.stringify({ id: "a".repeat(64), name: "/" + state.containerName,
  runId: state.runId, running: true, ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: state.port }] } });
else if (args[0] === "logs") stdout = state.serverLog;
else if (args.includes("createdb")) database(args.at(-1));
else if (args.includes("psql")) {
  const name = args[args.indexOf("-d") + 1];
  const db = database(name);
  const stdin = args.includes("-f") && args.at(-1) === "-";
  const sql = stdin ? fs.readFileSync(0, "utf8") : args[args.indexOf("-c") + 1];
  if (stdin) {
    if (!args.includes("--interactive") || Buffer.byteLength(sql) > 16 * 1024 * 1024 || sql.includes("\0")) throw new Error("synthetic stdin transport rejected");
    event.stdinBytes = Buffer.byteLength(sql);
  }
  event.database = name;
  if (sql.startsWith("-- local-tail ")) {
    const match = /^-- local-tail (213|215|218|221) (before|supply|committed)/u.exec(sql);
    if (!match || stdin !== (match[2] === "supply")) throw new Error("synthetic tail transport mismatch");
    event.action = "tail-" + match[2]; event.stage = Number(match[1]);
    const phase = "tail" + match[1] + (match[2] === "committed" ? "-readback" : "-" + match[2]);
    const observed = require(path.join(state.prismaRoot, "testdata/local-staged-tail-model.cjs")).observe(sql, phase);
    observed.ledger = ledger(db);
    if (state.tailFailureKind === "RESOURCE_PORT" && match[2] === "supply" ||
      state.tailFailureKind === "NODE_PROOF" && match[2] === "committed") {
      event.syntheticFailure = state.tailFailureKind;
      if (state.tailFailureKind === "NODE_PROOF") observed.protectedAclSha256 = "e".repeat(64);
      else {
        const appName = args.find(value => value.startsWith("PGAPPNAME="))?.slice("PGAPPNAME=".length);
        state.serverLog = "JG-PFQ|" + appName + "|" + name + "|202|P0001|ERROR:  synthetic tail failure\n";
        if (!args.includes("PGOPTIONS=-c log_min_error_statement=panic -c log_error_verbosity=terse"))
          state.serverLog += "STATEMENT: " + sql + "\n";
        stderr = "synthetic client SELECT secret-role"; exitCode = 23;
      }
    }
    stdout = JSON.stringify(observed);
  } else if (sql.startsWith("-- local-fixture inspect")) stdout = JSON.stringify(inspectDatabase(name, db));
  else if (sql.includes("CREATE SCHEMA jg_fixture_")) {
    const match = /'(\{"database":[^\n]+?\})'/u.exec(sql);
    db.plan = JSON.parse(match[1]);
    db.setup = { runId: db.plan.runId, appOid: String(30001 + state.appCount++), fileCallerOids: [10, 20004, 20005],
      schemaOid: "31001", controlOid: "31002", eventOid: "31003", qualified: true };
    state.roles.push(inert(db.plan.appName, Number(db.setup.appOid)));
    stdout = JSON.stringify(db.setup);
  } else if (sql.startsWith("-- local-fixture readback")) {
    const anchors = [
      [204, "ALTER TABLE", "pg_class", "ContractArchiveFile", null],
      [204, "CREATE FUNCTION", "pg_proc", "protectProjectParticipatingCompanyEndDate", "bf63fd6b2e56aa7d6562f0ab2793ee9f87fd3ffaacb03aee7f3f7162e34c5faa"],
      [205, "ALTER TABLE", "pg_class", "ContractVersion", null],
      [205, "ALTER FUNCTION", "pg_proc", "jg_contract_direct_pending_file_guard_v1", "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1"]
    ];
    const beforeRoutes = [...db.setup.fileCallerOids, Number(db.setup.appOid)].sort((a,b)=>a-b)
      .map(role => [String(role), "51", "52", 23, true, true, true, false,
        role !== Number(db.setup.appOid), false, null, [[8, false]], role !== Number(db.setup.appOid), false, false]);
    if (state.oversizedStage205Database === name) {
      let bytes = Buffer.byteLength(JSON.stringify(beforeRoutes));
      for (let id = 50001; bytes < 256000; id++) {
        const denied = ["30001", String(id), "53", 23, true, true, false, false, false, false,
          null, [[8, false]], false, false, false];
        beforeRoutes.push(denied);
        bytes += Buffer.byteLength(JSON.stringify(denied)) + 1;
      }
      beforeRoutes.sort((left, right) => Number(left[0]) - Number(right[0]) || Number(left[1]) - Number(right[1]));
    }
    const afterRoutes = JSON.parse(JSON.stringify(beforeRoutes));
    afterRoutes.find(row => row[0] === db.setup.appOid)[8] = true;
    const transition = { versionOid: "52", before: beforeRoutes, after: afterRoutes,
      callers: [...db.setup.fileCallerOids, Number(db.setup.appOid)].sort((a,b)=>a-b),
      acl: ["INSERT", "SELECT", "UPDATE"].map(p => ["10", db.setup.appOid, p, false]) };
    stdout = require(path.join(state.prismaRoot, "testdata/local-stage205-readback-model.cjs")).frameStage205({
      ...inspectDatabase(name, db), ...db.setup, readerPid: 202, fileCallerTransition: transition,
      events: anchors.map(([stage, tag, catalog, anchorName, bodySha256], index) => ({ ordinal: index + 1,
        stage, tag, catalog, name: anchorName, bodySha256, objectOid: index === 2 ? "52" : String(40001 + index),
        querySha256: row(stage - 1).sha256, runId: db.plan.runId, nonce: db.plan.nonce,
        databaseOid: db.plan.databaseOid, systemIdentifier: db.plan.systemIdentifier, actorOid: "10",
        appOid: db.setup.appOid, fileCallerOids: db.setup.fileCallerOids, backendPid: 101,
        backendStart: "2026-11-10T12:00:00.123456Z", transactionId: index < 2 ? "1001" : "1002",
        preceding: { ...row(stage - 2), finished: true, rolledBack: false }
      })) });
    event.readbackWireBytes = Buffer.byteLength(stdout);
  } else if (sql.startsWith("-- local-fixture cleanup-readback")) stdout = JSON.stringify({ schemaAbsent: true,
    eventAbsent: true, appOid: db.setup.appOid, applicationQualified: true });
  else if (sql.startsWith("-- local-fixture cleanup")) stdout = "{}";
  else if (sql.includes('COALESCE("logs",')) {
    event.action = "retained-failure-log";
    stdout = state.retainExpectedReason ? db.reason ?? "" : "unknown_failure";
  } else if (sql.includes("md5(COALESCE")) {
    event.action = "business-snapshot";
    stdout = "quota-unchanged|files-unchanged|user-unchanged";
  } else if (sql.includes("FROM information_schema.columns")) {
    event.action = "rollback-proof";
    stdout = db.failed && !db.resolved && db.applied === 114 ? "0\n1|0|0" : "0\n0|1|0";
  } else if (sql.includes('"attachmentFileSha256Snapshot" IS NULL')) stdout = db.applied >= 115 ? "1|1" : "0|0";
  else if (sql.includes('"terminationActionId" IS NULL')) stdout = "terminated|t|t|历史终止";
  else if (sql.includes("被篡改")) fail("project financing quota termination facts are immutable");
  else if (sql.includes('FROM "_prisma_migrations"')) {
    if (sql.includes(row(113).name)) stdout = "114|1|0";
    else if (sql.includes(row(114).name)) stdout = state.migrations.length + "|1|1|1|" + row(114).sha256 + "|" + row(115).sha256;
    else stdout = state.migrations.length + "|1|0|" + row(115).sha256;
  } else if (db.failed && !db.resolved && (/SET "signatureFileId" = NULL/u.test(sql) ||
    /SET "supersedesFileObjectId" = NULL/u.test(sql) || /DELETE FROM "ProjectFinancingQuota"/u.test(sql))) {
    event.action = "remediate";
    db.remediated = true;
  }
}
state.events.push(event);
fs.writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = exitCode;
