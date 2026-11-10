"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("seven-fragment preimage renders independent v7 reference predicates without altering the business table", () => {
  const { renderCurrent259SevenPreimage } = require("./task16-current259-seven-preimage.cjs");
  const { setupSql, witnessSql, cleanupSql } = renderCurrent259SevenPreimage("d".repeat(64));
  assert.match(setupSql, /CREATE TEMP TABLE pg_temp\."jg_current259_seven_reference"/u);
  assert.match(setupSql, /"fundExecutionId" IS NOT NULL AND "fundExecutionCaseId" IS NOT NULL/u);
  assert.match(setupSql, /WHEN \(OLD\."fundExecutionId" IS NULL AND OLD\."executionAllocationLineId" IS NULL\)/u);
  assert.equal([...setupSql.matchAll(/NOT VALID/gu)].length, 2);
  assert.match(setupSql, /LOCK TABLE ONLY public\."InterEntityRelationshipEntry" IN ACCESS EXCLUSIVE MODE/u);
  assert.doesNotMatch(setupSql, /(?:ALTER|DROP) TABLE public\./u);
  assert.throws(() => renderCurrent259SevenPreimage("injected nonce"), /TASK16_CURRENT259_SEVEN_PREIMAGE/u);
  assert.match(witnessSql, /pg_catalog\.pg_get_expr/u);
  assert.match(witnessSql, /pg_catalog\.pg_get_triggerdef/u);
  assert.equal(cleanupSql, 'DROP TABLE pg_temp."jg_current259_seven_reference";');
});

const NONCE = "d".repeat(64);
const OWNER = "10";
const TABLE = "InterEntityRelationshipEntry";
const BODY_PINS = [
  ["guard_inter_entity_relationship_entry", "194899e78a9f3c0f6e1b36ad6c2811dd48946ab0bf6d08868616414026122366"],
  ["guard_inter_entity_relationship_source_snapshot", "3f0ca600a89568b34d87fac4650e15a12fea28fbaf7066e298792534724f9583"],
  ["guard_inter_entity_relationship_proxy_authorization", "4bca4995db0adecaae0ec5f0e4ee27f028460e9ab0a33f26161902d90353fb3f"],
];
const TRIGGER_SLOTS = [
  ["inter_entity_relationship_entry_guard_payment_write", 0, 23, "new"],
  ["inter_entity_relationship_entry_guard_payment_delete", 0, 11, "old"],
  ["zz_inter_entity_relationship_source_snapshot_guard", 1, 23, "new"],
  ["zzz_inter_entity_relationship_proxy_authorization_guard", 2, 23, "new"],
];
const CHECK_SLOTS = [
  ["reference_check", true, ["evidenceFileId", "idempotencyKey"]],
  ["shape_check", true, ["entryKind", "direction", "adjustsEntryId", "paymentExecutionId", "settlementCaseId",
    "fundExecutionId", "fundExecutionCaseId", "executionAllocationLineId"]],
  ["payer_attestation_check", false, ["entryKind", "authorizationEvidenceFileId", "authorizationEvidenceContentSha256",
    "reauthorizationReference", "reauthorizedByUserId", "reauthorizedAt",
    "actualPayerVerificationEvidenceFileId", "actualPayerVerificationContentSha256"]],
  ["return_evidence_claim_check", false, ["entryKind", "evidenceClaimId", "evidenceUploadedByUserId", "evidenceContentSha256"]],
  ["source_snapshot_shape_check", true, ["entryKind", "projectId", "contractId", "contractVersionId", "sourceType",
    "sourceAggregateId", "sourceAllocationCount", "sourceAllocationAmountCents", "amountCents"]],
];

function syntheticObservation() {
  const guards = BODY_PINS.map(([name, bodySha256], index) => ({
    name, bodySha256, oid: String(500 + index), namespaceOid: "2200", ownerOid: OWNER,
    language: "plpgsql", kind: "f", returnTypeOid: "2279", securityDefiner: false, strict: false,
    returnsSet: false, leakproof: false, volatility: "v", parallel: "u", cost: 100, rowEstimate: 0,
    supportOid: "0", variadicOid: "0", nargs: 0, argDefaults: 0, argTypes: "",
    allArgTypes: null, argModes: null, argNames: null, argDefaultsExpr: null, transformTypes: null,
    binary: null, sqlBody: null, configuration: null, acl: null,
  }));
  const names = [...new Set(CHECK_SLOTS.flatMap(([, , columns]) => columns))].sort();
  function table(temporary) {
    const relation = {
      oid: temporary ? "701" : "601", namespaceOid: temporary ? "6000" : "2200",
      ownerOid: OWNER, kind: "r", persistence: temporary ? "t" : "p", partition: false,
      rowSecurity: false, forceRowSecurity: false, hasInheritance: false,
    };
    const columns = names.map((name, index) => {
      let [typeOid, typmod, collationOid] = ["25", -1, "100"];
      if (name === "sourceAllocationCount") [typeOid, typmod, collationOid] = ["23", -1, "0"];
      if (["amountCents", "sourceAllocationAmountCents"].includes(name)) [typeOid, typmod, collationOid] = ["20", -1, "0"];
      if (name === "reauthorizedAt") [typeOid, typmod, collationOid] = ["1114", 3, "0"];
      return {
        name, number: temporary ? index + 1 : 2 * (names.length - index),
        typeOid, typmod, collationOid,
        notNull: ["amountCents", "direction", "entryKind", "evidenceFileId", "idempotencyKey"].includes(name),
        generated: "", identity: "",
      };
    });
    const checks = CHECK_SLOTS.map(([suffix, validated, keyNames], index) => {
      // Synthetic server output only. Real PG deparse must be produced from the
      // fixed reference DDL in the same transaction as the observed table.
      const expression = "(simulated_complete_expression_" + suffix + ")";
      return {
        name: TABLE + "_" + suffix, oid: String((temporary ? 720 : 620) + index),
        relationOid: relation.oid, namespaceOid: relation.namespaceOid, type: "c", validated,
        local: true, inheritCount: 0, noInherit: false, parentOid: "0", indexOid: "0",
        referencedRelationOid: "0", deferrable: false, initiallyDeferred: false,
        key: keyNames.map(name => columns.find(column => column.name === name).number),
        tree: "synthetic conbin for " + suffix, expression,
        definition: "CHECK (" + expression + ")" + (validated ? "" : " NOT VALID"),
      };
    });
    const triggers = TRIGGER_SLOTS.map(([name, index, type, tuple], i) => {
      const when = "((" + tuple + '."fundExecutionId" IS NULL) AND (' + tuple + '."executionAllocationLineId" IS NULL))';
      return {
        name, type, when, oid: String((temporary ? 730 : 630) + i), relationOid: relation.oid,
        functionOid: guards[index].oid, enabled: "O", internal: false,
        parentOid: "0", constraintOid: "0", constraintRelationOid: "0", indexOid: "0",
        nargs: 0, args: "", columns: "", deferrable: false, initiallyDeferred: false,
        oldTable: null, newTable: null, qualifier: "synthetic tgqual", definition: "synthetic trigger definition " + relation.oid + " " + name,
      };
    });
    return { relation, columns, checks, triggers };
  }
  return {
    version: 160010, isolation: "serializable", deparsePremises: true,
    publicOid: "2200", tempOid: "6000", currentOwnerOid: OWNER, sessionOwnerOid: OWNER, nonce: NONCE, guards,
    actual: table(false), expected: table(true),
  };
}

function parse(observed) {
  const { parseCurrent259SevenPreimage } = require("./task16-current259-seven-preimage.cjs");
  return parseCurrent259SevenPreimage(JSON.stringify(observed), OWNER, NONCE);
}

test("a complete source-qualified observation retains only the actual relation and object identities", () => {
  const observed = syntheticObservation();
  const result = parse(observed);
  assert.deepEqual(result.guards, observed.guards);
  assert.deepEqual(result.actual, observed.actual);
  assert.equal(Object.hasOwn(result, "expected"), false);
  assert.ok(Object.isFrozen(result.actual.checks[0].key));
});

const rejected = (observed, field) => assert.throws(
  () => parse(observed),
  error => error.code === "TASK16_CURRENT259_SEVEN_PREIMAGE" && error.field === field,
);

test("a changed guard body or configuration cannot inherit the original guard's qualification", () => {
  for (const drift of [
    guard => { guard.bodySha256 = "e".repeat(64); },
    guard => { guard.configuration = ["search_path=public"]; },
    guard => { guard.ownerOid = "99"; },
    guard => { guard.securityDefiner = true; },
  ]) {
    const observed = syntheticObservation();
    drift(observed.guards[0]);
    rejected(observed, BODY_PINS[0][0]);
  }
});

test("each trigger requires its source function and complete v7 WHEN in the correct row event", () => {
  for (const drift of [
    trigger => { trigger.when = '(old."fundExecutionId" IS NULL)'; },
    trigger => { trigger.functionOid = "501"; },
    trigger => { trigger.enabled = "D"; },
    trigger => { trigger.type = 23; },
  ]) {
    const observed = syntheticObservation();
    drift(observed.actual.triggers[1]);
    rejected(observed, TRIGGER_SLOTS[1][0]);
  }
});

test("a changed CHECK predicate or column binding and a shared NOT VALID drift are rejected", () => {
  const shape = syntheticObservation();
  shape.actual.checks[1].expression = "(legacy_shape_without_v7_fund_branch)";
  rejected(shape, TABLE + "_shape_check");

  const binding = syntheticObservation();
  binding.actual.checks[0].key.pop();
  rejected(binding, TABLE + "_reference_check");

  for (const index of [2, 3]) {
    const observed = syntheticObservation();
    observed.actual.checks[index].validated = true;
    observed.expected.checks[index].validated = true;
    rejected(observed, observed.actual.checks[index].name);
  }
});

test("unqualified owner, transaction or reference identity cannot supply the preimage", () => {
  const wrongOwner = syntheticObservation();
  wrongOwner.currentOwnerOid = "99";
  rejected(wrongOwner, "observation");

  const stale = syntheticObservation();
  stale.nonce = "f".repeat(64);
  rejected(stale, "observation");

  const weakIsolation = syntheticObservation();
  weakIsolation.isolation = "read committed";
  rejected(weakIsolation, "observation");

  const typeDrift = syntheticObservation();
  for (const side of [typeDrift.actual, typeDrift.expected]) {
    side.columns.find(column => column.name === "sourceAllocationAmountCents").typeOid = "23";
  }
  rejected(typeDrift, "sourceAllocationAmountCents");

  const sharedIdentity = syntheticObservation();
  sharedIdentity.expected.relation.oid = sharedIdentity.actual.relation.oid;
  for (const item of [...sharedIdentity.expected.checks, ...sharedIdentity.expected.triggers]) {
    item.relationOid = sharedIdentity.actual.relation.oid;
  }
  rejected(sharedIdentity, "relation");
});

test("unknown catalog fields cannot be retained as qualified actual state", () => {
  const observed = syntheticObservation();
  observed.actual.relation.claim = { executeSql: true };
  rejected(observed, "relation");
});
