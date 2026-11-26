"use strict";

const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { Prisma } = require("@prisma/client");
const { a24ColumnPlan, renderA24FixtureAcl, readSignatureExclusiveClosure, verifySignatureExclusiveClosure } = require("./task426-a24-native-acl.cjs");

test("uses column privileges on the exact shape without granting financial ledger writes or observer writes", () => {
  const plan = a24ColumnPlan(Prisma.dmmf.datamodel.models);
  for (const table of ["OperatingFact", "OperatingImpactEntry", "OperatingLedgerWriteSecret", "OperatingLedgerWriteContext"]) {
    assert.equal(plan.insert[table], undefined);
    assert.equal(plan.update[table], undefined);
  }
  assert.deepEqual(plan.insert.ExpensePublicCashCostLink, ["id", "operationalPaymentId", "costImpactId", "amountCents"]);
  assert.equal(plan.update.ExpensePublicCashCostLink, undefined);
  assert.deepEqual(plan.update.OperatingCostAttributionConfirmation, [
    "status", "activeKey", "reviewedByUserId", "reviewedAt", "reviewReason", "revision", "updatedAt"
  ]);
  const rendered = renderA24FixtureAcl(plan, "jg_a24_application", "jg_a24_observer");
  const observer = rendered.split("\n").filter(row => row.endsWith('TO "jg_a24_observer";'));
  assert.equal(observer.length, 6);
  assert.ok(observer.every(row => row.startsWith("GRANT SELECT (")));
  assert.doesNotMatch(rendered, /GRANT [^\n]+ (?:ON ALL|WITH GRANT OPTION)/u);
});

test("covers the login audit create RETURNING columns without granting audit reads to the observer", () => {
  const models = Prisma.dmmf.datamodel.models;
  const audit = models.find(model => model.name === "AuditLog");
  assert.ok(audit);
  const plan = a24ColumnPlan(models);
  const returned = audit.fields.filter(field => field.kind !== "object").map(field => field.dbName || field.name);
  assert.deepEqual([...plan.read.AuditLog].sort(), returned.sort());
  assert.equal(plan.update.AuditLog, undefined);
  assert.equal(plan.observer.AuditLog, undefined);
});

test("signature creation can read its guarded coordinates without broadening fixture writes", () => {
  const plan = a24ColumnPlan(Prisma.dmmf.datamodel.models);
  const coordinates = {
    ContractTakeoverCorrection: ["attachmentFileId", "correctionType", "schemaVersion"],
    ContractEconomicReviewFileReference: ["fileId", "objectKey"],
    ContractArchiveFile: ["id", "contractVersionId", "archiveProtocolVersion", "archiveSource"],
    ContractArchiveEvidenceFile: ["fileId", "archiveFileId", "contractVersionId"],
    PaymentExecution: ["voucherFileId"],
    ProjectExpenseExecution: ["voucherFileId"],
    ProjectFinancingQuota: ["attachmentFileId"],
    RegisteredPaymentVoucher: ["fileId"],
    SettlementRecoveryEntry: ["evidenceFileId"],
    SpotProcurementReceiptPhoto: ["originalFileId", "watermarkedFileId"],
    ContractSignedChange: ["appendixFormalFileId"],
    SignedContractSettlementAttachment: ["fileId"]
  };
  const grants = renderA24FixtureAcl(plan, "jg_a24_application", "jg_a24_observer").split("\n");
  for (const [table, columns] of Object.entries(coordinates)) {
    assert.deepEqual(plan.read[table], columns);
    assert.equal(plan.insert[table], undefined);
    assert.equal(plan.update[table], undefined);
    assert.equal(plan.observer[table], undefined);
    assert.deepEqual(grants.filter(grant => grant.includes('ON public."' + table + '"')), [
      'GRANT SELECT (' + columns.map(column => '"' + column + '"').join(", ") + ') ON public."' + table + '" TO "jg_a24_application";'
    ]);
  }
});

test("covers the complete 340 signature registry including promotions and the prepared voucher install", () => {
  const prisma = path.resolve(__dirname, "../prisma");
  const migrations = path.join(prisma, "migrations");
  const files = readdirSync(migrations, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name >= "20260728137000")
    .map(entry => path.join(migrations, entry.name, "migration.sql")).sort();
  files.push(path.join(prisma, "prepared/task16/registered-voucher.sql"));
  const registry = new Map();
  let definitions = 0;
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const [, , body] of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?jg_file_business_binding_columns\(\)[^$]*\bAS\s+(\$\w*\$)([\s\S]*?)\1/giu)) {
      const values = [...body.matchAll(/\(\s*'([A-Za-z]+)'\s*,\s*'([A-Za-z]+)'\s*,\s*(TRUE|FALSE)\s*\)/giu)];
      const promotions = [...body.matchAll(/WHEN\s+"tableName"\s*=\s*'([A-Za-z]+)'\s+AND\s+"columnName"\s*=\s*'([A-Za-z]+)'\s+THEN\s+(TRUE|FALSE)/giu)];
      assert.ok(values.length + promotions.length > 0, file);
      for (const [, table, column, exclusive] of [...values, ...promotions]) {
        registry.set(table + "." + column, exclusive === "TRUE");
      }
      definitions++;
    }
  }
  assert.equal(definitions, 24);
  const plan = a24ColumnPlan(Prisma.dmmf.datamodel.models);
  const closure = [...registry].filter(([, exclusive]) => exclusive).map(([key]) => key).sort().map(key => {
    const [table, column] = key.split(".");
    return [table, column, plan.read[table]?.includes(column) ?? false];
  });
  assert.equal(verifySignatureExclusiveClosure(closure).count, 33);
  assert.match(readSignatureExclusiveClosure("jg_a24_application"), /jg_file_business_collision_columns\(\).*WHERE binding\."exclusive"/u);
  const denied = closure.map(([table, column, grants]) => [table, column, table === "ProjectFinancingQuota" ? false : grants]);
  assert.throws(() => verifySignatureExclusiveClosure(denied), /NATIVE_A24_SIGNATURE_REGISTRY_SELECT_DENIED/u);
  assert.throws(() => verifySignatureExclusiveClosure(closure.slice(1)), /NATIVE_A24_SIGNATURE_REGISTRY_COUNT/u);
  assert.throws(() => verifySignatureExclusiveClosure([...closure].reverse()), /NATIVE_A24_SIGNATURE_REGISTRY_DRIFT/u);
});

test("refuses an unintended role or changed attribution shape", () => {
  const plan = a24ColumnPlan(Prisma.dmmf.datamodel.models);
  assert.throws(() => renderA24FixtureAcl(plan, "jg_a24_application", "jg_a24_application"));
  assert.throws(() => renderA24FixtureAcl(plan, "jg_a24_application", "external_actor"));
  const bad = Prisma.dmmf.datamodel.models.map(model => model.name === "ExpensePublicCashCostLink"
    ? { ...model, fields: model.fields.filter(field => field.name !== "costImpactId") }
    : model);
  assert.throws(() => a24ColumnPlan(bad), /NATIVE_A24_REQUIRED_COLUMN/u);
});
