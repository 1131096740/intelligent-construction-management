"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { officialDocumentProfile } = require("./task12-official-document-profiles.cjs");
const os = require("node:os");
const { captureArchive, installArchive } = require("./seal-retirement-329-archive.cjs");
const controls = require("./local-staged-migration-controls.cjs");
const { createLocalTailQualification, localTailFailureDiagnostic } = require("./local-staged-tail-qualification.cjs");

const api = path.resolve(__dirname, "..");
const root = path.resolve(api, "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const owner = "jg_task01_owner";
const shaPattern = /^[a-f0-9]{64}$/u;
const env = { PATH: path.dirname(process.execPath) + ":/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" };
const git = args => execFileSync("/usr/bin/git", args, { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
const tracked = () => git(["status", "--porcelain", "--untracked-files=no"]).toString().trim();
const identifier = value => '"' + value.replaceAll('"', '""') + '"';

function file(pathname, expected) {
  assert.ok(path.isAbsolute(pathname) && fs.realpathSync(pathname) === pathname && fs.lstatSync(pathname).isFile());
  const bytes = fs.readFileSync(pathname);
  assert.equal(hash(bytes), expected);
  return bytes;
}

function captureSource(candidate, paymentRemainder, a24Profile, expenseTerminal) {
  assert.match(candidate, /^[a-f0-9]{40}$/u);
  assert.equal(git(["rev-parse", "HEAD"]).toString().trim(), candidate);
  assert.equal(tracked(), "");
  const ledger = git(["ls-tree", "-r", "--name-only", "-z", candidate, "--", "services/api/prisma/migrations"]).toString().split("\0")
    .filter(name => name.endsWith("/migration.sql"))
    .map(name => ({ name: path.basename(path.dirname(name)), sha256: hash(fs.readFileSync(path.join(root, name))), finished: true, rolledBack: false }));
  if (a24Profile) {
    const tree = git(["rev-parse", candidate + "^{tree}"]).toString().trim();
    if (expenseTerminal !== 352) return a24Profile.qualifyA24Source(candidate, tree, ledger, expenseTerminal);
    const prefix = a24Profile.qualifyA24Source(candidate, tree, ledger.slice(0, 346), 346);
    const archive = JSON.parse(execFileSync(process.execPath,
      [path.join(root, ".github/task12-install-295/contract-finance/check-ledger.cjs"), root, candidate, "--company-history-352"], { env }));
    assert.equal(ledger.length, 352);
    assert.equal(hash(JSON.stringify(ledger)), archive.ledgerSha256);
    return { ...prefix, ledger, ledgerDigest: archive.ledgerSha256, a24Prefixes: [...prefix.a24Prefixes, 349, 350, 351, 352] };
  }
  assert.ok(paymentRemainder ? ledger.length === 331 : ledger.length === 329 || ledger.length === 330);
  const mode = paymentRemainder ? "--payment-remainder-331" : ledger.length === 330 ? "--text-direct-330" : "--current-320";
  const archive = JSON.parse(execFileSync(process.execPath,
    [path.join(root, ".github/task12-install-295/contract-finance/check-ledger.cjs"), root, candidate, mode], { env }));
  assert.equal(hash(JSON.stringify(ledger)), archive.ledgerSha256);
  return { candidate, sourceTree: archive.sourceTree, ledgerDigest: archive.ledgerSha256, ledger,
    ...(paymentRemainder ? { predecessor330: archive.predecessor330 } : {}) };
}

function captureRuntime(pgManifestPath, pgManifestSha, documentPath, documentSha, office, officeSha) {
  assert.ok([pgManifestSha, documentSha, officeSha].every(digest => shaPattern.test(digest)));
  const manifest = JSON.parse(file(pgManifestPath, pgManifestSha));
  assert.equal(manifest.versionObserved, "postgres (PostgreSQL) 16.15");
  for (const [name, row] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(name) && !name.split("/").includes(".."));
    assert.equal(file(path.join(manifest.privatePrefix, name), row.sha256).length, row.bytes);
  }
  for (const [name, row] of Object.entries(manifest.externalLibraries)) assert.equal(file(name, row.sha256).length, row.bytes);
  const required = ["bin/initdb", "bin/postgres", "bin/psql", "bin/pg_ctl", "share/postgresql/extension/pgcrypto.control"];
  assert.ok(required.every(name => Object.hasOwn(manifest.files, name)));
  const document = JSON.parse(file(documentPath, documentSha));
  const lock = JSON.parse(fs.readFileSync(path.join(api, "assets/document-converter/runtime-lock.json")));
  assert.equal(document.fonts.length, lock.fonts.length);
  const fonts = lock.fonts.map(({ name, sha256 }) => {
    const [font, duplicate] = document.fonts.filter(row => row.name === name);
    assert.ok(font && !duplicate);
    file(font.path, sha256);
    return { name, path: font.path };
  });
  assert.equal(officeSha, "81c7db1c6dbcdd606d95abef337b4529aeda6a4fa1cf23a5a567f9c5655c8b66");
  file(office, officeSha);
  const { nativeSha256 } = officialDocumentProfile("TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2");
  const nativeOffice = path.resolve(path.dirname(office), "../../native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice");
  file(nativeOffice, nativeSha256);
  return { pg: manifest.privatePrefix, document: documentPath, documentSha, office, officeSha, nativeOfficeSha: nativeSha256, fonts };
}

function isolateOffice(runtime, directory) {
  const officeHome = path.join(directory, "office-home");
  const cache = path.join(directory, "office-cache");
  const fonts = path.join(directory, "office-fonts");
  for (const target of [officeHome, cache, fonts]) fs.mkdirSync(target, { mode: 0o700 });
  for (const font of runtime.fonts) {
    assert.match(font.name, /^[a-z0-9-]+$/u);
    fs.copyFileSync(font.path, path.join(fonts, font.name + ".ttf"), fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL);
  }
  const config = path.join(directory, "fonts.conf");
  fs.writeFileSync(config, '<?xml version="1.0"?><fontconfig><dir>' + fonts + '</dir><cachedir>' + cache + '</cachedir></fontconfig>\n',
    { flag: "wx", mode: 0o600 });
  const args = { PATH: "/usr/bin:/bin", HOME: officeHome, TMPDIR: directory, FONTCONFIG_FILE: config,
    XDG_CACHE_HOME: cache, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const shim = path.join(directory, "soffice");
  fs.writeFileSync(shim, "#!/bin/sh\nexec /usr/bin/env -i " +
    Object.entries(args).map(([key, value]) => key + "=" + quote(value)).join(" ") + " " + quote(runtime.office) + ' "$@"\n',
    { flag: "wx", mode: 0o700 });
  return shim;
}

function localPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

const liveForwardPrefixes = count => [271, 289, 295, 329, 330, 331].filter(size => size <= count);

function migrationPrefixes(directory, source) {
  const { ledger } = source;
  const sizes = [203, 205, 213, 215, 218, 221, 263, ...liveForwardPrefixes(ledger.length), ...(source.a24Prefixes ?? [])];
  return new Map(sizes.map(size => {
    const prefix = path.join(directory, "prefix-" + size);
    fs.mkdirSync(path.join(prefix, "migrations"), { recursive: true, mode: 0o700 });
    for (const file of ["schema.prisma", "migrations/migration_lock.toml"]) {
      fs.copyFileSync(path.join(__dirname, file), path.join(prefix, file), fs.constants.COPYFILE_EXCL);
    }
    for (const row of ledger.slice(0, size)) {
      const relative = "migrations/" + row.name + "/migration.sql";
      fs.mkdirSync(path.dirname(path.join(prefix, relative)), { mode: 0o700 });
      fs.writeFileSync(path.join(prefix, relative), file(path.join(__dirname, relative), row.sha256), { flag: "wx", mode: 0o600 });
    }
    return [size, path.join(prefix, "schema.prisma")];
  }));
}

async function migrate({ source, archive, database, directory, sql, url, run, stage, runId, port, a24Profile, pendingExpense, cashVoucher, operatingCash }) {
  const prefixes = migrationPrefixes(directory, source);
  const deploy = (size, target = url) => {
    stage("MIGRATE_" + size);
    run(process.execPath, [require.resolve("prisma"), "migrate", "deploy", "--schema", prefixes.get(size)], {
      DATABASE_URL: target.toString(), PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1"
    }, undefined, 180_000);
  };
  const migrations = source.ledger.map(({ name, sha256 }) => ({ name, sha256 }));
  const inspect = () => JSON.parse(sql(controls.inspectSql()));
  const identity = row => {
    assert.equal(row.database, database);
    assert.equal(row.ownerOid, "10");
    assert.equal(row.actorOid, "10");
    assert.equal(row.actor, owner);
    assert.equal(row.sessionActor, owner);
    assert.equal(row.version, 160015);
    assert.equal(row.encoding, "UTF8");
    assert.equal(row.replication, "origin");
    return Object.fromEntries(["database", "databaseOid", "namespaceOid", "actorOid", "ownerOid", "systemIdentifier"].map(key => [key, row[key]]));
  };
  deploy(203);
  const first = inspect();
  const bound = identity(first);
  assert.deepEqual(first.ledger, source.ledger.slice(0, 203));
  const verify = (row, size) => {
    assert.deepEqual(identity(row), bound);
    assert.deepEqual(row.ledger, source.ledger.slice(0, size));
  };
  const plan = { ...bound, runId: randomUUID(), nonce: secret(), appName: "jg_fixture_app_" + randomBytes(12).toString("hex"),
    schemaName: "jg_fixture_" + randomBytes(12).toString("hex"), technicalProfile: "CURRENT259_OWNED_TECHNICAL_V1",
    resourceRunId: runId, migrations: migrations.slice(0, 205) };
  const setup = JSON.parse(sql(controls.setupSql(plan)));
  controls.checkSetup(setup, plan);
  const qualified = new URL(url);
  qualified.searchParams.set("options", "-c app.contract_archive_v2_application_role_oid=" + setup.appOid +
    " -c app.contract_archive_v2_file_caller_oids=" + JSON.stringify(setup.fileCallerOids) + " -c app.local_migration_nonce=" + plan.nonce);
  deploy(205, qualified);
  stage("READBACK_205");
  const completed = controls.parseReadback(sql(controls.readbackSql(plan, setup)));
  verify(completed, 205);
  controls.checkCompletion(completed, plan, setup);
  sql(controls.cleanupSql(plan, setup));
  stage("CLEAN_READBACK_205");
  const clean = JSON.parse(sql(controls.cleanReadSql(plan, setup)));
  assert.ok(clean.schemaAbsent && clean.eventAbsent && clean.applicationQualified && clean.appOid === setup.appOid);
  const read = async (_phase, text) => JSON.parse(sql(text));
  stage("TAIL_SETUP");
  const tailMaterials = [];
  const tail = createLocalTailQualification({ plan, setup, migrations }, { read, write: read, recordMaterial(row) {
    assert.equal(hash(row.sql), row.afterSha256);
    tailMaterials.push({ kind: row.kind, beforeSha256: row.beforeSha256, afterSha256: row.afterSha256 });
  } });
  for (const size of [213, 215, 218, 221]) {
    deploy(size);
    verify(inspect(), size);
    await tail.qualify(size);
  }
  deploy(263);
  verify(inspect(), 263);
  const archiveMaterial = installArchive(archive, sql, runId, port, { name: plan.appName, oid: setup.appOid, nonce: plan.nonce }, stage);
  let paymentRemainderPredecessor;
  const a24Installation = [];
  const signed350 = source.ledger.length === 352 ? require("../../.." + "/.github/task12-install-295/contract-finance/signed-settlement-350-profile.cjs") : null;
  let signed350Before, signed350After;
  const readSigned350 = () => JSON.parse(sql("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,pg_temp;" + signed350.catalogSql + "ROLLBACK;"));
  const expenseFactCatalog = {};
  const cashVoucherCatalog = {};
  const operatingCashCatalog = {};
  const historicalCatalog = a24Profile?.createHistoricalCatalogCheck?.(statement => JSON.parse(
    sql("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,pg_temp;" + statement + "ROLLBACK;")
  ));
  const readCashVoucher = size => JSON.parse(sql(
    "BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,pg_temp;" + cashVoucher.readCatalog(size) + "ROLLBACK;"
  ));
  const readOperatingCash = size => JSON.parse(sql(
    "BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,pg_temp;" + operatingCash.readCatalog(size, plan.appName) + "ROLLBACK;"
  ));
  for (const size of [...liveForwardPrefixes(source.ledger.length), ...(source.a24Prefixes ?? [])]) {
    if (pendingExpense && size === 342) {
      stage("A24_MIGRATE_342_FIRST_SQL_ERROR");
      const terminal = source.ledger[341];
      const terminalPath = path.join(__dirname, "migrations", terminal.name, "migration.sql");
      sql(pendingExpense.rollbackMigration342(file(terminalPath, terminal.sha256).toString("utf8")));
      verify(inspect(), 341);
      assert.deepEqual(JSON.parse(sql(pendingExpense.readOperatingFactValidator(plan.appName))), expenseFactCatalog[341]);
    }
    if (cashVoucher && size === 344) {
      stage("A24_MIGRATE_344_FIRST_SQL_ERROR");
      const terminal = source.ledger[343];
      const terminalPath = path.join(__dirname, "migrations", terminal.name, "migration.sql");
      sql(pendingExpense.rollbackMigration342(file(terminalPath, terminal.sha256).toString("utf8")));
      verify(inspect(), 343);
      assert.deepEqual(readCashVoucher(343), cashVoucherCatalog[343], "NATIVE_A24_344_PREVIEW_ROLLBACK");
    }
    if (operatingCash && size === 346) {
      stage("A24_MIGRATE_346_FIRST_SQL_ERROR");
      const terminal = source.ledger[345];
      const terminalPath = path.join(__dirname, "migrations", terminal.name, "migration.sql");
      sql(pendingExpense.rollbackMigration342(file(terminalPath, terminal.sha256).toString("utf8")));
      verify(inspect(), 345);
      assert.deepEqual(readOperatingCash(345), operatingCashCatalog[345], "NATIVE_A24_346_PREVIEW_ROLLBACK");
    }
    deploy(size);
    const installed = inspect();
    verify(installed, size);
    if (source.a24Prefixes?.includes(size)) {
      if (size > 346) {
        const digest = hash(JSON.stringify(installed.ledger));
        require("../../.." + "/.github/task12-install-295/contract-finance/company-history-352-profile.cjs").assertPrefix(size, digest);
        a24Installation.push({ count: size, ledgerSha256: digest, sameIdentity: true });
      } else a24Installation.push(a24Profile.verifyA24Prefix(size, installed.ledger));
      if (historicalCatalog && [332, 333, 334, 340, 341, 342, 343, 344, 345, 346].includes(size)) {
        stage("A24_HISTORICAL_CATALOG_" + size);
        historicalCatalog.atPrefix(size);
      }
    }
    if (signed350 && size === 349) signed350Before = readSigned350();
    if (signed350 && size === 350) {
      signed350After = readSigned350();
      signed350.assertCatalog(signed350After, signed350Before);
    }
    if (pendingExpense && (size === 341 || size === 342)) {
      stage("A24_PENDING_COST_FACT_CATALOG_" + size);
      expenseFactCatalog[size] = pendingExpense.verifyOperatingFactValidator(
        JSON.parse(sql(pendingExpense.readOperatingFactValidator(plan.appName))), expenseFactCatalog[341]
      );
    }
    if (cashVoucher && [342, 343, 344].includes(size)) {
      stage("A24_CASH_VOUCHER_CATALOG_" + size);
      cashVoucherCatalog[size] = cashVoucher.verifyCatalog(size, readCashVoucher(size), cashVoucherCatalog[size - 1]);
    }
    if (operatingCash && [345, 346].includes(size)) {
      stage("A24_OPERATING_CASH_CATALOG_" + size);
      operatingCashCatalog[size] = operatingCash.verifyCatalog(size, readOperatingCash(size), operatingCashCatalog[345]);
    }
    if (size === 330 && source.predecessor330) {
      const ledgerSha256 = hash(JSON.stringify(installed.ledger));
      assert.equal(ledgerSha256, source.predecessor330.ledgerSha256);
      paymentRemainderPredecessor = { count: size, ledgerSha256, sameIdentity: true };
    }
  }
  const verifyAfterBusiness = () => {
    const final = inspect();
    verify(final, source.ledger.length);
    if (signed350) assert.deepEqual(readSigned350(), signed350After, "NATIVE_A08_352_SIGNED_GUARDS_AFTER_BUSINESS");
    return { count: final.ledger.length, ledgerSha256: hash(JSON.stringify(final.ledger)), sameIdentity: true };
  };
  return { appOid: setup.appOid, app: plan.appName, tailMaterials, archiveMaterial,
    paymentRemainderPredecessor, a24Installation, historicalCatalog, expenseFactCatalog, cashVoucherCatalog, readCashVoucher, operatingCashCatalog, readOperatingCash, verifyAfterBusiness };
}

function grantApplication(sql, database, app, appPassword) {
  // The archive and operating facts retain the grants installed by the product
  // migrations. Only the explicit contract, template and auth tables used by
  // the public workflow are added to this isolated qualification role.
  const { tables, retainRowLocks, businessPartyRowLockFallback } = require("./task16-current259-ordinary-archive-acl.requirements.json");
  const worker = require("./task12-current259-document-acl.json").roles.jg_c259_doc_worker;
  const comparison = worker.ContractDocumentComparison;
  const [, , userLoginColumns] = tables.User;
  const userUpdateColumns = [...userLoginColumns, "signatureFileId"];
  const known = Object.keys(tables).filter(table => !["OperatingFact", "OperatingImpactEntry"].includes(table));
  const writes = {
    INSERT: ["AuditLog", "AuthRateLimit", "RefreshToken", "FileObject", "BusinessDailySequence", "Contract", "ContractVersion", "ContractBill", "ContractBillRow",
      "ContractDraftEditLease", "ContractDraftSaveRequest", "ContractPartySnapshot", "PaymentTermsVersion", "PaymentTermsStage",
      "ContractLayoutTemplate", "ContractLayoutTemplateVersion", "ContractLayoutPreviewJob", "ContractOfflineRevision", "ContractGeneratedDocument",
      "ApprovalInstance", "ApprovalActionLog", "HandwrittenSignatureVersion", "ContractDraftSubmissionRequest", "ContractSealTask",
      "ContractArchiveFile", "ContractArchiveEvidenceFile"],
    UPDATE: ["AuthRateLimit", "RefreshToken", "BusinessDailySequence", "Contract", "ContractVersion", "ContractBill", "ContractBillRow",
      "ContractDraftEditLease", "ContractPartySnapshot", "PaymentTermsVersion", "PaymentTermsStage", "ContractLayoutTemplate",
      "ContractLayoutTemplateVersion", "ContractLayoutPreviewJob", "ContractOfflineRevision", "ContractGeneratedDocument",
      "ApprovalInstance", "ApprovalActionLog", "ContractSealTask"],
    DELETE: ["AuthRateLimit", "RefreshToken", "ContractBillRow", "ContractPartySnapshot", "PaymentTermsStage"]
  };
  const reads = [...new Set([...known, ...Object.values(writes).flat(), "SignedContractSettlement", "SettlementDraft",
    "ApprovalFlow", "ApprovalFlowNode", "ApprovalDelegation", "ContractBusinessTemplate", "ContractBusinessTemplateVersion",
    "ContractVersionAuthorizationLink"])];
  const role = identifier(app);
  const existing = new Set(JSON.parse(sql("SELECT jsonb_agg(tablename) FROM pg_tables WHERE schemaname='public';")));
  const grant = (privilege, names) => {
    assert.ok(names.every(name => existing.has(name)), "NATIVE_329_GRANT_SCHEMA");
    return "GRANT " + privilege + " ON " + names.map(name => "public." + identifier(name)).join(",") + " TO " + role + ";";
  };
  const grantColumns = (privilege, table, columns) => {
    assert.ok(existing.has(table), "NATIVE_329_GRANT_SCHEMA");
    return "GRANT " + privilege + " (" + columns.map(identifier).join(", ") + ") ON public." + identifier(table) + " TO " + role + ";";
  };
  const locks = Object.entries({ ...retainRowLocks, BusinessParty: businessPartyRowLockFallback }).map(([table, column]) => {
    const granted = sql("SELECT pg_catalog.has_any_column_privilege('" + app + "', 'public." + identifier(table) + "'::regclass, 'UPDATE');").trim();
    assert.ok(granted === "t" || granted === "f");
    return granted === "f" ? grantColumns("UPDATE", table, [column]) : "";
  });
  const newBindingReads = [
    ["ContractSignedChange", "appendixFormalFileId"],
    ["SignedContractSettlementAttachment", "fileId"]
  ];
  // The effective contract detail loads these two bound projections together.
  const effectiveDetailReaders = [
    "public.jg_read_ordinary_contract_tax_fact_v1(text,text,integer)",
    "public.jg_read_effective_contract_change_amount_v1(text,text,text)"
  ];
  sql("BEGIN;" +
    "ALTER ROLE " + role + " LOGIN PASSWORD '" + appPassword + "' CONNECTION LIMIT 12;" +
    "GRANT CONNECT ON DATABASE " + identifier(database) + " TO " + role + ";" +
    "GRANT USAGE ON SCHEMA public TO " + role + ";" + grant("SELECT", reads) +
    Object.entries(writes).map(([privilege, names]) => grant(privilege, names)).join("") +
    grantColumns("UPDATE", "User", userUpdateColumns) +
    grantColumns("SELECT", "ProjectRosterMember", ["projectId", "userId"]) +
    grantColumns("SELECT", "ContractNumberTombstone", ["id", "formalCode"]) +
    grantColumns("SELECT", "FundExecutionCase", ["approvalInstanceId", "auditAction"]) +
    grantColumns("SELECT", "ContractDocumentComparison", comparison.select) +
    grantColumns("UPDATE", "ContractDocumentComparison", comparison.update) +
    grantColumns("SELECT", "ContractDraftCheckpoint", ["contractVersionId", "id", "sequenceNo", "name", "snapshot", "createdByUserId", "createdAt"]) +
    newBindingReads.map(([table, column]) => grantColumns("SELECT", table, [column])).join("") +
    locks.join("") +
    "GRANT EXECUTE ON FUNCTION " + effectiveDetailReaders.join(", ") + " TO " + role + ";" +
    "COMMIT;");
  const detailAcl = sql(`
    SELECT ${effectiveDetailReaders.map(routine => `has_function_privilege('${app}', '${routine}', 'EXECUTE')
      AND NOT has_function_privilege('${app}', '${routine}', 'EXECUTE WITH GRANT OPTION')`).join(" AND ")}
      AND NOT has_function_privilege('${app}', 'public.jg_list_ordinary_contract_tax_facts_v1(text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('${app}', 'public.jg_write_ordinary_contract_tax_fact_v1(text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
      AND NOT has_any_column_privilege('${app}', 'public."ContractTaxFactRevision"', 'INSERT, UPDATE, REFERENCES')
      AND NOT has_table_privilege('${app}', 'public."ContractTaxFactRevision"', 'DELETE, TRUNCATE, TRIGGER');
  `).trim();
  assert.equal(detailAcl, "t", "NATIVE_329_EFFECTIVE_DETAIL_ACL");
  for (const [table, column] of newBindingReads) {
    const exact = sql(`
      SELECT has_column_privilege('${app}',target.relation,'${column}','SELECT')
        AND NOT has_table_privilege('${app}',target.relation,'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        AND NOT EXISTS (SELECT FROM pg_catalog.pg_attribute a
          WHERE a.attrelid=target.relation AND a.attnum>0 AND NOT a.attisdropped
          AND (has_column_privilege('${app}',target.relation,a.attnum,'SELECT WITH GRANT OPTION, INSERT, UPDATE, REFERENCES')
            OR (a.attname<>'${column}' AND has_column_privilege('${app}',target.relation,a.attnum,'SELECT'))))
      FROM (VALUES ('public."${table}"'::regclass)) AS target(relation);
    `).trim();
    assert.equal(exact, "t", "NATIVE_329_FILE_BINDING_COLUMNS");
  }
}

async function main(args) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const expenseApproval = args.length === 12 && args.at(-2) === "--payment-remainder-331" && args.at(-1) === "--approval-round-a04";
  const issue430ApprovalSms = args.length === 12 && args.at(-2) === "--payment-remainder-331" && args.at(-1) === "--issue430-approval-sms";
  const businessMode = args.length === 12 && args.at(-2) === "--payment-remainder-331" && args.at(-1);
  const a08Is352 = ["--approval-archive-a08-inside-352", "--approval-archive-a08-outside-352", "--approval-archive-a08-upward-352"].includes(businessMode);
  const a08Inside346 = businessMode === "--approval-archive-a08-inside-346" || businessMode === "--approval-archive-a08-inside-352";
  const expenseOperatingCash346 = businessMode === "--expense-cash-a24-combined-346";
  const a08DirectRelationship = new Map([
    ["--approval-archive-a08-outside-346", "outside"],
    ["--approval-archive-a08-upward-346", "upward"],
    ["--approval-archive-a08-outside-352", "outside"],
    ["--approval-archive-a08-upward-352", "upward"]
  ]).get(businessMode);
  const a08Any346 = a08Inside346 || Boolean(a08DirectRelationship);
  const combined346 = a08Any346 || expenseOperatingCash346;
  const expenseCashVoucher344 = combined346 || businessMode === "--expense-cash-a24-combined-344";
  const expensePending342 = expenseCashVoucher344 || businessMode === "--expense-cash-a24-combined-342";
  const expenseAssignment341 = expensePending342 || businessMode === "--expense-cash-a24-combined-341";
  const a24Profile = businessMode === "--expense-cash-a24"
    ? require("../test-support/task426-a24-native-profile.cjs")
    : businessMode === "--expense-cash-a24-combined-340" || expenseAssignment341
      ? require("../test-support/task426-a24-native340-profile.cjs")
      : undefined;
  // The A08 modes reuse the combined migration checks with their own HTTP roles.
  const expenseCashA24 = Boolean(a24Profile) && !a08Any346;
  const paymentRemainder = expenseApproval || issue430ApprovalSms || Boolean(a24Profile) || (args.length === 11 && args.at(-1) === "--payment-remainder-331");
  assert.ok(args.length === 10 || paymentRemainder);
  const [mode, sha, pgManifest, pgSha, docManifest, docSha, office, officeSha, archiveAdmission, archiveSha] = args;
  assert.ok(["verify", "run"].includes(mode));
  const source = captureSource(sha, paymentRemainder, a24Profile, a08Is352 ? 352 : combined346 ? 346 : expenseCashVoucher344 ? 344 : expensePending342 ? 342 : expenseAssignment341 ? 341 : undefined);
  const normalArchiveRecipeSha = "90b698f5230ae172518e285bf8c4e197eb1d552518c55670c2b3794eb82f1b75";
  file(path.join(__dirname, "task12-normal274-archive-binding.cjs"), normalArchiveRecipeSha);
  const approvalLockRecipeSha = "5d565dc516cd26c64e3fda295b97968be7912abc62f47ab47ffd93be29fd6c2f";
  file(path.join(__dirname, "task12-native-approval-lock.cjs"), approvalLockRecipeSha);
  assert.match(archiveSha, shaPattern);
  const archive = captureArchive(archiveAdmission, archiveSha, source, { file, hash });
  const runtime = captureRuntime(pgManifest, pgSha, docManifest, docSha, office, officeSha);
  const receipt = { candidate: sha, sourceTree: source.sourceTree, migrations: source.ledger.length, ledgerSha256: source.ledgerDigest,
    postgresMaterialSha256: pgSha, historicalSourceAdmissionSha256: archiveSha, normalArchiveRecipeSha256: normalArchiveRecipeSha, approvalLockRecipeSha256: approvalLockRecipeSha, documentManifestSha256: docSha, libreOfficeWrapperSha256: officeSha, libreOfficeExecutableSha256: runtime.nativeOfficeSha,
    status: "HOST_MATERIAL_VERIFIED", stages: [], cleanup: "NOT_NEEDED" };
  if (a08Inside346) receipt.profile = "APPROVAL_ARCHIVE_A08_INSIDE_" + (a08Is352 ? "352" : "346");
  const a08Runtime = a08DirectRelationship && require("../test-support/task426-a08-native-runtime.cjs");
  let a08Direct;
  if (a08Runtime) {
    const { captureA08Direct346Source, captureA08Direct352Source } = require("../test-support/task426-a08-upward-pin-332-profile.cjs");
    const sourceProfile = (a08Is352 ? captureA08Direct352Source : captureA08Direct346Source)(sha, source.sourceTree, source.ledger);
    a08Direct = await a08Runtime.prepareNativeA08Mode({ ...source, sourceProfile }, a08DirectRelationship);
    receipt.profile = "APPROVAL_ARCHIVE_A08_DIRECT_" + (a08Is352 ? "352" : "346");
    receipt.a08 = a08Direct.evidence;
    if (mode === "run") a08Runtime.compileNativeA08Application({ root, api, env });
  }
  const a24Acl = expenseCashA24 && require("../test-support/task426-a24-native-acl.cjs");
  const a24Assignment = expenseCashA24 && expenseAssignment341 && require("../test-support/task426-a24-native341-assignment.cjs");
  const pendingExpense = expensePending342 && require("../test-support/task426-a24-native342-fact.cjs");
  const cashVoucher = expenseCashVoucher344 && require("../test-support/task426-a24-native344-voucher.cjs");
  const operatingCash = combined346 && require("../test-support/task426-a24-native346-operating.cjs");
  const baseA24Plan = a24Acl && a24Acl.a24ColumnPlan(require("@prisma/client").Prisma.dmmf.datamodel.models, expensePending342);
  const a24Plan = baseA24Plan && cashVoucher ? cashVoucher.addCashVoucherAcl(baseA24Plan) : baseA24Plan;
  if (a24Plan) receipt.a24AclSha256 = hash(JSON.stringify(a24Plan));
  if (a24Profile) receipt.a24ExpectedPrefixes = source.a24Prefixes.map(size => {
    if (size > 346) {
      const ledgerSha256 = hash(JSON.stringify(source.ledger.slice(0, size)));
      require("../../.." + "/.github/task12-install-295/contract-finance/company-history-352-profile.cjs").assertPrefix(size, ledgerSha256);
      return { count: size, ledgerSha256 };
    }
    const { ledgerSha256 } = a24Profile.verifyA24Prefix(size, source.ledger.slice(0, size));
    return { count: size, ledgerSha256 };
  });
  if (mode === "verify") return receipt;

  const directory = fs.mkdtempSync("/private/tmp/jg425-seal-329-");
  const data = path.join(directory, "data");
  const socket = path.join(directory, "socket");
  const runId = randomUUID();
  const database = "jg_task01_" + runId.replaceAll("-", "");
  const ownerPassword = secret();
  const appPassword = secret();
  let phase = "INIT";
  let startAttempted = false;
  let firstFailure;
  const stage = next => { phase = next; receipt.stages.push(phase); };
  const bin = name => path.join(runtime.pg, "bin", name);
  const run = (program, command, extra = {}, input, timeout = 60_000) => {
    const result = spawnSync(program, command, { cwd: api, env: { ...env, HOME: directory, ...extra },
      input, encoding: "utf8", maxBuffer: 3 * 1024 * 1024, timeout });
    if (result.status !== 0) {
      // Some tools return connection strings and fixture secrets on failure.
      // Each command's projection is limited to its status and business stage.
      const errorText = (result.stderr ?? "") + "\n" + (result.stdout ?? "");
      const diagnostic = errorText.match(/(?:SEAL_329_NATIVE_FAILURE|NATIVE_A24_FAILURE) (\{[^\n]{1,1500}\})/u)?.[1];
      const prismaCode = errorText.match(/(?:Error: |^)(P[0-9]{4})\b/mu)?.[1];
      const sqlState = (errorText.match(/Database error code:\s*([0-9A-Z]{5})\b/u) ??
        errorText.match(/^(?:psql:.*?: )?ERROR:\s+([0-9A-Z]{5}):/mu))?.[1];
      const reportedMigration = errorText.match(/Migration name:\s*(\d{14}_[a-z0-9_]{1,140})\b/u)?.[1];
      const migration = source.ledger.some(row => row.name === reportedMigration) ? reportedMigration : undefined;
      // Prisma sometimes reports a native-driver error without a P-code.
      // Project only the first database error line and redact all local connection coordinates.
      const firstErrorProbe = ["A24_MIGRATE_342_FIRST_SQL_ERROR", "A24_MIGRATE_344_FIRST_SQL_ERROR",
        "A24_MIGRATE_346_FIRST_SQL_ERROR"].includes(phase);
      const firstSqlError = phase === "A24_MIGRATE_346_FIRST_SQL_ERROR" && operatingCash
        ? operatingCash.projectMigrationError(errorText)
        : phase === "A24_MIGRATE_344_FIRST_SQL_ERROR" && cashVoucher
        ? cashVoucher.projectMigrationError(errorText)
        : firstErrorProbe && pendingExpense ? pendingExpense.projectMigration342Error(errorText) : undefined;
      const reason = firstErrorProbe ? undefined : /^Error:\s*(?:ERROR:\s*)?([^\n]{1,200})$/mu.exec(errorText)?.[1]
        ?.replace(/postgres(?:ql)?:\/\/\S+/gu, "[database URL]")
        ?.replace(/\/private\/tmp\/[^\s"']+/gu, "[owned path]")
        ?.replace(/\b(?:jg_task01_|jg_fixture_app_)?[a-f0-9]{24,}\b/gu, "[private id]");
      firstFailure ??= { stage: phase, exit: result.status, signal: result.signal ?? undefined, prismaCode, sqlState, migration, reason,
        ...(firstSqlError ? { firstSqlError } : {}),
        ...(diagnostic ? { diagnostic: JSON.parse(diagnostic) } : {}) };
      throw new Error("NATIVE_329_COMMAND");
    }
    return result.stdout;
  };
  try {
    stage("OFFICE_PROFILE");
    const office = isolateOffice(runtime, directory);
    const port = await localPort();
    const certificate = path.join(directory, "server.crt");
    const ca = path.join(directory, "ca.crt");
    const caKey = path.join(directory, "ca.key");
    const wrongCa = path.join(directory, "wrong-ca.crt");
    const request = path.join(directory, "server.csr");
    const extensions = path.join(directory, "server.ext");
    const key = path.join(directory, "server.key");
    const passwordFile = path.join(directory, "owner-password");
    fs.writeFileSync(passwordFile, ownerPassword + "\n", { mode: 0o600, flag: "wx" });
    fs.mkdirSync(socket, { mode: 0o700 });
    const openssl = args => run("/usr/bin/openssl", args);
    for (const [name, target, privateKey] of [["primary", ca, caKey], ["wrong", wrongCa, path.join(directory, "wrong-ca.key")]]) {
      openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-x509", "-sha256", "-days", "1",
        "-subj", "/CN=native-" + name + "-" + runId, "-keyout", privateKey, "-out", target]);
      fs.chmodSync(privateKey, 0o600);
    }
    fs.writeFileSync(extensions, "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n", { mode: 0o600, flag: "wx" });
    openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=native-" + runId,
      "-keyout", key, "-out", request]);
    fs.chmodSync(key, 0o600);
    openssl(["x509", "-req", "-sha256", "-days", "1", "-in", request, "-CA", ca, "-CAkey", caKey,
      "-set_serial", "1", "-extfile", extensions, "-out", certificate]);
    run(bin("initdb"), ["-D", data, "--username", owner, "--pwfile", passwordFile, "--auth-local=peer", "--auth-host=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
    const osUser = os.userInfo().username;
    assert.match(osUser, /^[A-Za-z0-9_]+$/u);
    fs.writeFileSync(path.join(data, "pg_hba.conf"), "local all " + owner + " peer map=native_owner\nhostssl all all 127.0.0.1/32 scram-sha-256\n");
    fs.writeFileSync(path.join(data, "pg_ident.conf"), "native_owner " + osUser + " " + owner + "\n");
    fs.appendFileSync(path.join(data, "postgresql.conf"), [
      "", "listen_addresses='127.0.0.1'", "port=" + port, "unix_socket_directories='" + socket + "'", "ssl=on",
      "ssl_cert_file='" + certificate + "'", "ssl_key_file='" + key + "'", "password_encryption='scram-sha-256'",
      "shared_buffers='32MB'", "min_wal_size='32MB'", "max_wal_size='64MB'", "log_min_error_statement='panic'",
      "log_parameter_max_length_on_error=0", "log_error_verbosity='terse'",
      ...(expenseCashA24 ? ["log_line_prefix='%e '"] : []), ""
    ].join("\n"));
    stage("PG_START");
    startAttempted = true;
    run(bin("pg_ctl"), ["start", "-D", data, "-l", path.join(directory, "postgres.log"), "-w", "-t", "30"]);
    const observed = fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").split("\n");
    assert.equal(observed[1], data);
    assert.equal(observed[3], String(port));
    assert.match(observed[0], /^[1-9][0-9]*$/u);
    receipt.postgres = { pid: Number(observed[0]), host: "127.0.0.1", port, version: "16.15" };
    process.stderr.write("NATIVE_329_POSTGRES_READY " + JSON.stringify(receipt.postgres) + "\n");
    const sql = (text, name = database) => run(bin("psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", name, "-f", "-"], {
      PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: owner, PGPASSWORD: ownerPassword,
      PGSSLMODE: "verify-full", PGSSLROOTCERT: ca, PGCONNECT_TIMEOUT: "5"
    }, text);
    sql("CREATE DATABASE " + database + " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';", "postgres");
    const ownerUrl = new URL("postgresql://" + owner + "@127.0.0.1:" + port + "/" + database);
    ownerUrl.password = ownerPassword;
    for (const [key, value] of Object.entries({ sslmode: "require", sslaccept: "strict", sslcert: ca, schema: "public", connection_limit: "1", connect_timeout: "5" })) {
      ownerUrl.searchParams.set(key, value);
    }
    stage("PG_TLS");
    assert.equal(sql("SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AND inet_client_addr() = '127.0.0.1'::inet;").trim(), "t");
    for (const mismatch of [{ PGSSLROOTCERT: wrongCa }, { PGSSLMODE: "disable" }]) {
      const negative = spawnSync(bin("psql"), ["-X", "-q", "-d", database, "-c", "SELECT 1"], {
        cwd: api, env: { ...env, HOME: directory, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: owner,
          PGPASSWORD: ownerPassword, PGSSLMODE: "verify-full", PGSSLROOTCERT: ca, PGCONNECT_TIMEOUT: "5", ...mismatch }, timeout: 7_000
      });
      assert.equal(negative.status, 2);
    }
    const { appOid, app, tailMaterials, archiveMaterial, paymentRemainderPredecessor,
      a24Installation, historicalCatalog, expenseFactCatalog, cashVoucherCatalog, readCashVoucher, operatingCashCatalog, readOperatingCash, verifyAfterBusiness } =
      await migrate({ source, archive, database, directory, sql, url: ownerUrl, run, stage, runId, port, a24Profile, pendingExpense, cashVoucher, operatingCash });
    receipt.tailMaterials = tailMaterials;
    receipt.archiveInstallation = archiveMaterial;
    if (a24Profile) {
      receipt.a24Installation = a24Installation;
      assert.deepEqual(a24Installation, receipt.a24ExpectedPrefixes.map(prefix => ({ ...prefix, sameIdentity: true })));
    }
    if (historicalCatalog) receipt.a24HistoricalCatalog = historicalCatalog.snapshots;
    if (pendingExpense) receipt.a24ExpenseFactCatalog = expenseFactCatalog;
    if (cashVoucher) receipt.a24CashVoucherCatalog = cashVoucherCatalog;
    if (operatingCash) receipt.a24OperatingCashCatalog = operatingCashCatalog;
    if (paymentRemainder) {
      assert.ok(paymentRemainderPredecessor);
      receipt.paymentRemainderPredecessor = paymentRemainderPredecessor;
    }
    stage("ROLE");
    if (!expenseCashA24 && !a08Direct) grantApplication(sql, database, app, appPassword);
    const appUrl = new URL(ownerUrl);
    appUrl.username = app;
    appUrl.password = appPassword;
    appUrl.searchParams.set("connection_limit", "8");
    const packet = path.join(directory, "input.json");
    const files = path.join(directory, "files");
    if (!a08Direct) {
      fs.writeFileSync(packet, JSON.stringify({ ownerUrl: ownerUrl.toString(), psql: bin("psql"), applicationOid: appOid, database, candidate: sha }), { mode: 0o600, flag: "wx" });
      fs.mkdirSync(files, { mode: 0o700 });
    }
    let checkLegacyWriterAcl;
    let checkCashVoucherAcl;
    if (expenseCashA24) {
      stage("A24_SCOPED_ROLES");
      const observationRole = "jg_a24_observer_" + runId.replaceAll("-", "");
      const observerPassword = secret();
      const operatingWriteSecret = secret();
      const appRole = identifier(app);
      const observerRole = identifier(observationRole);
      const db = identifier(database);
      sql(`BEGIN;
        ALTER ROLE ${appRole} LOGIN PASSWORD '${appPassword}' CONNECTION LIMIT 12;
        ALTER ROLE ${appRole} IN DATABASE ${db} SET log_min_error_statement = 'error';
        CREATE ROLE ${observerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${observerPassword}' CONNECTION LIMIT 2;
        ALTER ROLE ${observerRole} SET default_transaction_read_only = on;
        GRANT CONNECT ON DATABASE ${db} TO ${appRole}, ${observerRole};
        GRANT USAGE ON SCHEMA public TO ${appRole}, ${observerRole};
        ${a24Acl.renderA24FixtureAcl(a24Plan, app, observationRole)}
        ${expenseOperatingCash346 ? cashVoucher.grantCapacityCheck(app) : ""}
        INSERT INTO public."OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,public.crypt('${operatingWriteSecret}',public.gen_salt('bf')));
        COMMIT;`);
      const scope = JSON.parse(sql(`
        SELECT jsonb_build_object('observerOid',observer.oid::text,'safe',
          NOT (observer.rolsuper OR observer.rolinherit OR observer.rolcreatedb OR observer.rolcreaterole OR observer.rolreplication OR observer.rolbypassrls)
          AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members member WHERE member.member = observer.oid OR member.roleid = observer.oid)
          AND NOT has_any_column_privilege('${app}', 'public."OperatingFact"', 'INSERT,UPDATE,REFERENCES')
          AND NOT has_any_column_privilege('${app}', 'public."OperatingImpactEntry"', 'INSERT,UPDATE,REFERENCES')
          AND NOT has_any_column_privilege('${app}', 'public."OperatingLedgerWriteSecret"', 'SELECT,INSERT,UPDATE,REFERENCES')
          AND NOT has_any_column_privilege('${app}', 'public."ExpensePublicCashCostLink"', 'UPDATE,REFERENCES')
          AND NOT has_table_privilege('${app}', 'public."ExpensePublicCashCostLink"', 'DELETE,TRUNCATE,TRIGGER')
          AND NOT EXISTS (
            SELECT FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace ns ON ns.oid=relation.relnamespace
            WHERE ns.nspname = 'public' AND relation.relkind IN ('r','p')
              AND (has_any_column_privilege(observer.oid, relation.oid, 'INSERT,UPDATE,REFERENCES')
                OR has_table_privilege(observer.oid, relation.oid, 'DELETE,TRUNCATE,TRIGGER')))
        )
        FROM pg_catalog.pg_roles observer WHERE observer.rolname = '${observationRole}';
      `));
      assert.equal(scope.safe, true, "A24_SCOPED_ROLES");
      if (expensePending342) {
        checkLegacyWriterAcl = () => {
          const observed = JSON.parse(sql(a24Acl.readA24LegacyWriterAcl(app, observationRole)));
          assert.deepEqual(observed, { routines: 2, restricted: true, directWritesDenied: true }, "A24_V1_WRITER_ACL");
          return observed;
        };
        stage("A24_V1_WRITER_ACL");
        receipt.a24LegacyWriterAcl = checkLegacyWriterAcl();
      }
      if (cashVoucher) {
        stage("A24_CASH_VOUCHER_ACL");
        checkCashVoucherAcl = () => {
          const observed = JSON.parse(sql(cashVoucher.readAcl(app, observationRole)));
          assert.deepEqual(observed, { writerRestricted: true, private: true, cashWriteWitnessReadsExact: true,
            historicalWriteDenied: true }, "A24_CASH_VOUCHER_ACL");
          if (expenseOperatingCash346) {
            assert.equal(sql(cashVoucher.readCapacityAcl(app, observationRole)).trim(), "true", "A24_CASH_CAPACITY_CHECK_ACL");
            observed.capacityCheckRestricted = true;
          }
          return observed;
        };
        receipt.a24CashVoucherAcl = checkCashVoucherAcl();
      }
      if (historicalCatalog) {
        stage("A24_SIGNATURE_EXCLUSIVE_ACL");
        const closure = JSON.parse(sql("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public,pg_temp;"
          + a24Acl.readSignatureExclusiveClosure(app) + "ROLLBACK;"));
        receipt.a24SignatureExclusiveAcl = a24Acl.verifySignatureExclusiveClosure(closure);
      }
      if (a24Assignment) {
        stage("A24_STANDALONE_ASSIGNMENT_BEFORE_BUSINESS");
        receipt.a24AssignmentLockBefore = a24Assignment.verifyExpenseAssignmentLock(
          JSON.parse(sql(a24Assignment.readExpenseAssignmentLock(app)))
        );
      }
      const observerUrl = new URL(ownerUrl);
      observerUrl.username = observationRole;
      observerUrl.password = observerPassword;
      const a24Packet = path.join(directory, "a24-input.json");
      fs.writeFileSync(a24Packet, JSON.stringify({ ownerUrl: ownerUrl.toString(), observerUrl: observerUrl.toString(),
        applicationOid: appOid, observerOid: scope.observerOid, database, candidate: sha }), { mode: 0o600, flag: "wx" });
      stage("A24_PUBLIC_CASH_AND_ATTRIBUTION");
      const outcome = run(process.execPath, [require.resolve("jest/bin/jest"), "--runInBand", "--testRegex",
        "task426-a24-native[.]test-support[.]ts$", "--runTestsByPath", "src/database/task426-a24-native.test-support.ts"], {
        NODE_ENV: "test", TMPDIR: directory, TASK426_A24_NATIVE_PACKET: a24Packet, DATABASE_URL: appUrl.toString(),
        ...(expenseAssignment341 ? { TASK426_A24_ASSIGNMENT_341: "1" } : {}),
        ...(cashVoucher ? { TASK426_A24_CASH_VOUCHER_344: "1" } : {}),
        FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: files, FILE_DOWNLOAD_SECRET: secret(),
        JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(), OPERATING_LEDGER_DB_WRITE_SECRET: operatingWriteSecret,
        CONTRACT_DOCX4J_RUNTIME_MANIFEST: runtime.document, DOC_CONVERTER_COMMAND: office
      }, undefined, 230_000);
      const proof = outcome.match(/NATIVE_A24_PROOF (\{[^\n]+\})/u);
      assert.ok(proof);
      receipt.proof = JSON.parse(proof[1]);
      assert.equal(receipt.proof.candidate, source.candidate);
    } else if (issue430ApprovalSms) {
      stage("APPROVAL_SMS_ISSUE430");
      const reportFile = path.join(directory, "issue430-approval-sms.json");
      try {
        const outcome = run(process.execPath, [require.resolve("jest/bin/jest"), "--runInBand", "--runTestsByPath",
          "src/approval/issue430-notification.pg.spec.ts", "src/fund-execution/fund-execution-entry.http.pg.spec.ts",
          "--json", "--outputFile", reportFile], {
          NODE_ENV: "test", TMPDIR: directory, RUN_POL115_ENTRY_PG16: "1", RUN_ISSUE430_SMS: "1",
          ISSUE430_NATIVE_PG_DATABASE: database, APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false",
          DATABASE_URL: ownerUrl.toString(), FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: files,
          FILE_DOWNLOAD_SECRET: secret(), JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret()
        }, undefined, 300_000);
        const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
        assert.equal(report.numPassedTests, 5);
        assert.equal(report.numFailedTests, 0);
        assert.equal(report.numPendingTests, 1); // Existing optional browser regression.
        const scenarios = [...outcome.matchAll(/\{"scenario":"([a-z_]+)","mockedCorrectionSends":3,"unknownResends":0,"externalSends":0\}/gu)]
          .map(match => match[1]).sort();
        assert.deepEqual(scenarios, ["expense_claim", "fund_execution_case", "project_expense_request",
          "project_financing_quota", "project_settlement_exception_quota"]);
        receipt.proof = { candidate: source.candidate, passed: report.numPassedTests, scenarios, externalSends: 0 };
      } catch (error) {
        if (firstFailure && fs.existsSync(reportFile) && fs.statSync(reportFile).size <= 1024 * 1024) {
          const { testResults } = JSON.parse(fs.readFileSync(reportFile, "utf8"));
          firstFailure.jest = testResults.flatMap(suite => suite.assertionResults.filter(row => row.status === "failed").map(row => {
            const message = row.failureMessages[0] ?? "";
            return {
              title: row.title,
              frame: /(?:issue430-notification(?:[.]test-support)?|fund-execution-entry[.]http)[.](?:pg[.]spec[.])?ts:(\d{1,5}):(\d{1,4})/u.exec(message)?.slice(1).map(Number),
              tags: [...new Set(message.match(/(?:P[0-9]{4}|[0-9]{2}P[0-9]{2}|[2-5][0-9]{2})/gu) ?? [])].slice(0, 8)
            };
          }));
        }
        throw error;
      }
    } else if (a08Direct) {
      receipt.a08.ownerCatalog = [];
      receipt.proof = await a08Runtime.runNativeA08Http(a08Direct, { sql, stage, ownerUrl, archiveMaterial,
        baseEnv: { ...env, HOME: directory, TMPDIR: directory },
        recordOwnerUpward(when, proof) { receipt.a08.ownerCatalog.push({ when, ...proof }); },
        recordOrdinaryReviewAcl(proof) { receipt.a08.ordinaryReviewAcl = proof; },
        recordArchiveStage(proof) { receipt.a08.archiveBeforeTicket = proof; } });
    } else if (expenseApproval) {
      stage("APPROVAL_ROUND_A04");
      const reportFile = path.join(directory, "approval-round-a04.json");
      try {
        run(process.execPath, [require.resolve("jest/bin/jest"), "--runInBand", "--runTestsByPath",
          "src/expense-claim/expense-claim-entry.http.pg.spec.ts", "--testNamePattern", "部分签批后被退回",
          "--json", "--outputFile", reportFile], {
          NODE_ENV: "test", TMPDIR: directory, RUN_POL115_ENTRY_PG16: "1", JG_NATIVE_331_A04_DATABASE: database,
          DATABASE_URL: ownerUrl.toString(), FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: files,
          FILE_DOWNLOAD_SECRET: secret(), JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret()
        }, undefined, 300_000);
      } catch (error) {
        if (firstFailure && fs.existsSync(reportFile) && fs.statSync(reportFile).size <= 1024 * 1024) {
          const { testResults } = JSON.parse(fs.readFileSync(reportFile, "utf8"));
          const suite = testResults[0];
          const assertion = suite?.assertionResults?.find(row => row.status === "failed");
          const message = assertion?.failureMessages?.[0] ?? suite?.message ?? "";
          firstFailure.jest = {
            failedTests: suite?.numFailingTests,
            frame: /expense-claim-entry[.]http[.]pg[.]spec[.]ts:(\d{1,5}):(\d{1,4})/u.exec(message)?.slice(1).map(Number),
            status: /Received:[\s\S]{0,300}?"status":\s*([1-5][0-9]{2})/u.exec(message)?.[1],
            prisma: /\bP[0-9]{4}\b/u.exec(message)?.[0],
            signatureImages: /A04_PDF_SIGNATURE_IMAGES (reimbursement|incidental_expense) ([0-9]{1,2}) ([0-9]{1,2})/u.exec(message)?.slice(1),
            kind: Object.entries({
              compile: /\bTS[0-9]{4}\b/u,
              module: /Cannot find module/u,
              timeout: /Exceeded timeout/u,
              parse: /Unexpected token|invalid JSON/iu,
              config: /must be configured|is not configured/iu,
              font: /font|glyph/iu
            }).flatMap(([key, pattern]) => pattern.test(message) ? [key] : [])
          };
        }
        throw error;
      }
      const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
      assert.equal(report.numPassedTests, 2);
      assert.equal(report.numFailedTests, 0);
      receipt.proof = { candidate: source.candidate, passed: report.numPassedTests };
    } else {
      stage("PUBLIC_LIFECYCLE");
      const outcome = run(process.execPath, [require.resolve("jest/bin/jest"), "--runInBand", "--testRegex", "seal-retirement-329[.]native[.]test-support[.]ts$", "--runTestsByPath", "src/database/seal-retirement-329.native.test-support.ts"], {
        NODE_ENV: "test", TMPDIR: directory, SEAL_329_NATIVE_PACKET: packet, DATABASE_URL: appUrl.toString(),
        FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: files, FILE_DOWNLOAD_SECRET: secret(), JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(),
        CONTRACT_DOCX4J_RUNTIME_MANIFEST: runtime.document, DOC_CONVERTER_COMMAND: office
      }, undefined, 450_000);
      const proof = outcome.match(/SEAL_329_NATIVE_PROOF (\{[^\n]+\})/u);
      assert.ok(proof);
      receipt.proof = JSON.parse(proof[1]);
      assert.equal(receipt.proof.candidate, source.candidate);
    }
    if (paymentRemainder) {
      stage(a08Is352 ? "READBACK_352_AFTER_BUSINESS" : a08Any346 ? "READBACK_346_AFTER_BUSINESS" : expenseCashA24 ? "READBACK_A24_AFTER_BUSINESS" : "READBACK_331_AFTER_BUSINESS");
      receipt.ledgerAfterBusiness = verifyAfterBusiness();
      assert.equal(receipt.ledgerAfterBusiness.ledgerSha256, source.ledgerDigest);
    }
    if (historicalCatalog && !a08Is352) {
      stage("A24_HISTORICAL_CATALOG_AFTER_BUSINESS");
      receipt.a24HistoricalCatalog["afterBusiness" + source.ledger.length] = historicalCatalog.verifyAfterBusiness();
    }
    if (a24Assignment) {
      stage("A24_STANDALONE_ASSIGNMENT_AFTER_BUSINESS");
      const result = a24Assignment.verifyExpenseAssignmentLock(JSON.parse(sql(a24Assignment.readExpenseAssignmentLock(app))));
      assert.deepEqual(result, receipt.a24AssignmentLockBefore, "NATIVE_A24_341_ASSIGNMENT_CATALOG_DRIFT");
      receipt.a24AssignmentLockAfter = result;
    }
    if (pendingExpense && !a08Is352) {
      stage("A24_PENDING_COST_FACT_CATALOG_AFTER_BUSINESS");
      const result = pendingExpense.verifyOperatingFactValidator(JSON.parse(sql(pendingExpense.readOperatingFactValidator(app))),
        expenseFactCatalog[341]);
      assert.deepEqual(result, expenseFactCatalog[342], "NATIVE_A24_342_CATALOG_AFTER_BUSINESS");
      expenseFactCatalog.afterBusiness = result;
      if (checkLegacyWriterAcl) {
        stage("A24_V1_WRITER_ACL_AFTER_BUSINESS");
        receipt.a24LegacyWriterAclAfterBusiness = checkLegacyWriterAcl();
      }
    }
    if (cashVoucher) {
      stage("A24_CASH_VOUCHER_CATALOG_AFTER_BUSINESS");
      const result = cashVoucher.verifyCatalog(344, readCashVoucher(344), cashVoucherCatalog[343]);
      assert.deepEqual(result, cashVoucherCatalog[344], "NATIVE_A24_344_CASH_VOUCHER_CATALOG_DRIFT");
      cashVoucherCatalog.afterBusiness = result;
      if (checkCashVoucherAcl) {
        stage("A24_CASH_VOUCHER_ACL_AFTER_BUSINESS");
        receipt.a24CashVoucherAclAfterBusiness = checkCashVoucherAcl();
      }
    }
    if (operatingCash) {
      stage("A24_OPERATING_CASH_CATALOG_AFTER_BUSINESS");
      const result = operatingCash.verifyCatalog(346, readOperatingCash(346), operatingCashCatalog[345]);
      assert.deepEqual(result, operatingCashCatalog[346], "NATIVE_A24_346_OPERATING_CATALOG_DRIFT");
      operatingCashCatalog.afterBusiness = result;
    }
    assert.equal(tracked(), "");
    file(runtime.document, runtime.documentSha);
    receipt.status = "PASSED";
  } catch (error) {
    receipt.status = "FAILED";
    const tail = localTailFailureDiagnostic(error);
    const catalogReason = (phase.startsWith("A24_CASH_VOUCHER_CATALOG_") || phase.startsWith("A24_OPERATING_CASH_CATALOG_"))
      ? /^NATIVE_A24_34[3456]_[A-Z_]{1,45}$/mu.exec(error.message)?.[0] : undefined;
    receipt.firstFailure = firstFailure ?? { stage: phase, code: typeof error.code === "string" && /^[A-Z0-9_]{1,50}$/u.test(error.code) ? error.code : "CHECK_FAILED",
      ...(catalogReason ? { catalogReason } : {}), ...(tail ? { tail } : {}),
      ...(a08Direct && Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus, expectedStatus: error.expectedStatus } : {}),
      ...(a08Direct && error.a08Prisma ? { prisma: error.a08Prisma } : {}),
      ...(a08Direct && error.a08TicketRead ? { ticketRead: error.a08TicketRead } : {}),
      ...(a08Direct && error.a08DirectSource ? { directSource: error.a08DirectSource } : {}),
      ...(a08Direct && error.a08DomainReason ? { domainReason: error.a08DomainReason } : {}),
      ...(a08Direct && error.a08DomainGuards ? { domainGuards: error.a08DomainGuards } : {}) };
    if (expenseCashA24 && phase === "A24_PUBLIC_CASH_AND_ATTRIBUTION") {
      const databaseLog = fs.readFileSync(path.join(directory, "postgres.log"), "utf8");
      const errorCodes = databaseLog.split("\n").flatMap(line => {
          const match = /^([0-9A-Z]{5}) ERROR:\s+(.*)$/u.exec(line);
          if (!match) return [];
          const code = /^(EXPENSE_PUBLIC_CASH_VOUCHER_[A-Z_]+|EXPENSE_OPERATING_CASH_[A-Z_]+)$/u.exec(match[2])?.[0];
          const permission = match[1] === "42501" &&
            /^permission denied for (table|relation|schema|function|sequence) ([A-Za-z_][A-Za-z0-9_]{0,62})$/u.exec(match[2]);
          return [{ sqlState: match[1], ...(code ? { code } : {}),
            ...(permission ? { permissionKind: permission[1], permissionObject: permission[2] } : {}) }];
        });
      receipt.firstFailure.databaseErrors = errorCodes.slice(-12);
      const attributionInsert = /^42501 STATEMENT:\s+INSERT INTO "public"[.]"OperatingCostAttributionConfirmation" \(((?:"[a-zA-Z][a-zA-Z0-9]*"(?:,\s*)?){1,30})\)/mu.exec(databaseLog);
      if (attributionInsert) {
        const columns = Array.from(attributionInsert[1].matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/gu), match => match[1]);
        const known = new Set(a24Plan.read.OperatingCostAttributionConfirmation);
        const granted = new Set(a24Plan.insert.OperatingCostAttributionConfirmation);
        receipt.firstFailure.attributionInsert = { columns: columns.filter(column => known.has(column)),
          missing: columns.filter(column => known.has(column) && !granted.has(column)) };
      }
    }
  } finally {
    try {
      if (startAttempted && fs.existsSync(path.join(data, "postmaster.pid"))) {
        run(bin("pg_ctl"), ["stop", "-D", data, "-m", "fast", "-w", "-t", "30"], {}, undefined, 35_000);
      }
      assert.ok(!fs.existsSync(path.join(data, "postmaster.pid")));
      fs.rmSync(directory, { force: true, recursive: true });
      assert.ok(!fs.existsSync(directory));
      receipt.cleanup = "VERIFIED";
    } catch {
      receipt.cleanup = "FAILED";
      receipt.status = "FAILED";
    }
  }
  return receipt;
}

if (require.main === module) main(process.argv.slice(2)).then(receipt => {
  process.stdout.write(JSON.stringify(receipt) + "\n");
  if (receipt.status === "FAILED") process.exitCode = 1;
}).catch(() => {
  process.stderr.write("NATIVE_329_ADMISSION_REJECTED\n");
  process.exitCode = 1;
});
