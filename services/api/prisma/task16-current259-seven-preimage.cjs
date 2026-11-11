"use strict";

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { SCHEMA205_DEPARSE_LOCAL, schema205DeparsePremisesSql } = require("./task16-registered-object-witness.cjs");

const CODE = "TASK16_CURRENT259_SEVEN_PREIMAGE";
const MAX_PREIMAGE_BYTES = 128 * 1024;
const failures = new WeakMap();
const TABLE = "InterEntityRelationshipEntry";
const PUBLIC = 'public."' + TABLE + '"';
const TEMP = 'pg_temp."jg_current259_seven_reference"';
const SOURCES = Object.freeze({
  relationship: ["20260828070000_pol13b_inter_entity_relationship", "9e250d48bf17300808ccb30683af7f035a481f632d8c49b4d56886eb3be19e50"],
  payer: ["20260828073000_pol13b_payer_attestation_lineage", "c0c8eb7ea4b728e4e5ab04397cf4716ab0711df1b7f7c51a19b27efa5a6cc5b5"],
  snapshot: ["20260828074000_pol13b_relationship_source_snapshot", "b1a83570734c3adf4699d3da4ed851aa1f14c255f6813f36d491e06f739b3d3f"],
  authority: ["20260828080000_pol13b_payer_authority_and_relation_guards", "9d7aae81f62752499e0be7acb487116eab846bf12e5792291d9bf42b1f15f067"],
  v7: ["20260831120000_pol13d_fund_execution_v7", "a166b7105343f6a19b629de1ba64073a167106731e114eb273db2a848dc22378"],
});
const GUARDS = [
  ["guard_inter_entity_relationship_entry", "payer"],
  ["guard_inter_entity_relationship_source_snapshot", "snapshot"],
  ["guard_inter_entity_relationship_proxy_authorization", "authority"],
];
const TRIGGERS = [
  ["inter_entity_relationship_entry_guard_payment_write", 0, "INSERT OR UPDATE", 23],
  ["inter_entity_relationship_entry_guard_payment_delete", 0, "DELETE", 11],
  ["zz_inter_entity_relationship_source_snapshot_guard", 1, "INSERT OR UPDATE", 23],
  ["zzz_inter_entity_relationship_proxy_authorization_guard", 2, "INSERT OR UPDATE", 23],
];
const CHECKS = [
  ["reference_check", "relationship", true],
  ["shape_check", "v7", true],
  ["payer_attestation_check", "payer", false],
  ["return_evidence_claim_check", "payer", false],
  ["source_snapshot_shape_check", "snapshot", true],
];
const TEXT = ["pg_catalog.text", "25", -1, "100"];
const NOT_NULL = new Set(["amountCents", "direction", "entryKind", "evidenceFileId", "idempotencyKey"]);
const COLUMN_TYPES = new Map([
  ["sourceAllocationCount", ["pg_catalog.int4", "23", -1, "0"]],
  ["sourceAllocationAmountCents", ["pg_catalog.int8", "20", -1, "0"]],
  ["amountCents", ["pg_catalog.int8", "20", -1, "0"]],
  ["reauthorizedAt", ["pg_catalog.timestamp(3)", "1114", 3, "0"]],
]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const need = (ok, field, reason) => {
  if (ok) return;
  const failure = Object.assign(new Error(CODE), { code: CODE, field });
  // Field names are fixed by this parser or its digest-pinned source recipe.
  failures.set(failure, Object.freeze({ preimageField: field, ...(reason ? { preimageReason: reason } : {}) }));
  throw failure;
};
function describeCurrent259SevenPreimageFailure(failure) {
  return failures.get(failure);
}
const sqlLiteral = value => "'" + value.replaceAll("'", "''") + "'";
const list = values => values.map(sqlLiteral).join(", ");

function singleMatch(text, pattern, field) {
  const matches = [...text.matchAll(pattern)];
  need(matches.length === 1, field);
  return matches[0];
}

function referencedColumns(predicate) {
  return [...new Set([...predicate.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/gu)].map(match => match[1]))].sort();
}

function sourceRecipe() {
  const sources = Object.fromEntries(Object.entries(SOURCES).map(([label, [name, sha]]) => {
    const bytes = readFileSync(path.join(__dirname, "migrations", name, "migration.sql"));
    need(hash(bytes) === sha, "source");
    return [label, bytes.toString("utf8")];
  }));
  const guards = GUARDS.map(([name, source]) => {
    const [, body] = singleMatch(sources[source], new RegExp(
      "FUNCTION " + name + "\\(\\)\\nRETURNS TRIGGER AS \\$\\$([\\s\\S]*?)\\$\\$ LANGUAGE plpgsql;", "gu",
    ), name);
    return { name, bodySha256: hash(body) };
  });
  const triggers = TRIGGERS.map(([name, guardIndex, event, type]) => {
    const guard = guards[guardIndex].name;
    const [, when] = singleMatch(sources.v7, new RegExp(
      'CREATE TRIGGER "?' + name + '"?\\s+BEFORE ' + event + ' ON "' + TABLE +
      '"\\s+FOR EACH ROW WHEN \\(([^\\n]+)\\)\\s+EXECUTE FUNCTION ' + guard + '\\(\\);', "gu",
    ), name);
    return { name, guard, event, type, when };
  });
  const checks = CHECKS.map(([suffix, source, validated]) => {
    const name = TABLE + "_" + suffix;
    const sql = sources[source];
    const start = singleMatch(sql, new RegExp('CONSTRAINT "' + name + '"\\s+CHECK\\s*\\(', "gu"), name);
    const from = start.index + start[0].length;
    let depth = 1;
    let quote;
    for (let i = from; i < sql.length; i++) {
      const char = sql[i];
      if (quote) {
        if (char === quote && sql[i + 1] === quote) i++;
        else if (char === quote) quote = undefined;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "(") {
        depth++;
      } else if (char === ")" && --depth === 0) {
        need(!/^\s+NOT VALID\b/u.test(sql.slice(i + 1)) === validated, name);
        const expression = sql.slice(from, i);
        return { name, expression, validated, columnNames: referencedColumns(expression) };
      }
    }
    need(false, name);
  });
  const names = new Set();
  for (const predicate of [...checks.map(check => check.expression), ...triggers.map(trigger => trigger.when)]) {
    for (const name of referencedColumns(predicate)) names.add(name);
  }
  const columns = [...names].sort().map(name => {
    const [sqlType, typeOid, typmod, collationOid] = COLUMN_TYPES.get(name) ?? TEXT;
    return { name, sqlType, typeOid, typmod, collationOid };
  });
  return { guards, triggers, checks, columns };
}

function witnessSql(recipe, nonce) {
  const names = kind => list(recipe[kind].map(item => item.name));
  const relation = name => `pg_catalog.to_regclass(${sqlLiteral(name)})`;
  const actual = relation(PUBLIC);
  const expected = relation(TEMP);
  const rows = (projection, from, where, order) =>
    `(SELECT coalesce(pg_catalog.jsonb_agg(${projection} ORDER BY ${order}), '[]'::pg_catalog.jsonb)
      FROM ${from} WHERE ${where})`;
  const relationRow = oid => `(SELECT pg_catalog.jsonb_build_object(
    'oid', c.oid::text, 'namespaceOid', c.relnamespace::text, 'ownerOid', c.relowner::text,
    'kind', c.relkind, 'persistence', c.relpersistence, 'partition', c.relispartition,
    'rowSecurity', c.relrowsecurity, 'forceRowSecurity', c.relforcerowsecurity,
    'hasInheritance', EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid OR i.inhparent = c.oid))
    FROM pg_catalog.pg_class c WHERE c.oid = ${oid})`;
  const columns = oid => rows(`pg_catalog.jsonb_build_object(
    'name', a.attname, 'number', a.attnum, 'typeOid', a.atttypid::text,
    'typmod', a.atttypmod, 'collationOid', a.attcollation::text, 'notNull', a.attnotnull,
    'generated', a.attgenerated, 'identity', a.attidentity)`,
  "pg_catalog.pg_attribute a",
  `a.attrelid = ${oid} AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN (${names("columns")})`, "a.attname");
  const checks = oid => rows(`pg_catalog.jsonb_build_object(
    'name', k.conname, 'oid', k.oid::text, 'relationOid', k.conrelid::text, 'namespaceOid', k.connamespace::text,
    'type', k.contype, 'validated', k.convalidated, 'local', k.conislocal, 'inheritCount', k.coninhcount,
    'noInherit', k.connoinherit, 'parentOid', k.conparentid::text, 'indexOid', k.conindid::text,
    'referencedRelationOid', k.confrelid::text, 'deferrable', k.condeferrable, 'initiallyDeferred', k.condeferred,
    'key', k.conkey, 'tree', k.conbin::text, 'expression', pg_catalog.pg_get_expr(k.conbin, k.conrelid, false),
    'definition', pg_catalog.pg_get_constraintdef(k.oid, false))`,
  "pg_catalog.pg_constraint k",
  `k.conrelid = ${oid} AND k.conname IN (${names("checks")})`, "k.conname");
  const triggers = oid => rows(`pg_catalog.jsonb_build_object(
    'name', t.tgname, 'oid', t.oid::text, 'relationOid', t.tgrelid::text, 'functionOid', t.tgfoid::text,
    'type', t.tgtype, 'enabled', t.tgenabled, 'internal', t.tgisinternal, 'parentOid', t.tgparentid::text,
    'constraintOid', t.tgconstraint::text, 'constraintRelationOid', t.tgconstrrelid::text, 'indexOid', t.tgconstrindid::text,
    'nargs', t.tgnargs, 'args', pg_catalog.encode(t.tgargs, 'hex'), 'columns', t.tgattr::text,
    'deferrable', t.tgdeferrable, 'initiallyDeferred', t.tginitdeferred, 'oldTable', t.tgoldtable, 'newTable', t.tgnewtable,
    'qualifier', t.tgqual::text, 'definition', pg_catalog.pg_get_triggerdef(t.oid, false),
    'when', pg_catalog.substring(pg_catalog.pg_get_triggerdef(t.oid, false), ' WHEN (.*) EXECUTE FUNCTION '))`,
  "pg_catalog.pg_trigger t",
  `t.tgrelid = ${oid} AND t.tgname IN (${names("triggers")})`, "t.tgname");
  const guards = rows(`pg_catalog.jsonb_build_object(
    'name', p.proname, 'oid', p.oid::text, 'namespaceOid', p.pronamespace::text, 'ownerOid', p.proowner::text,
    'language', l.lanname, 'kind', p.prokind, 'returnTypeOid', p.prorettype::text,
    'bodySha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex'),
    'securityDefiner', p.prosecdef, 'strict', p.proisstrict, 'returnsSet', p.proretset, 'leakproof', p.proleakproof,
    'volatility', p.provolatile, 'parallel', p.proparallel, 'cost', p.procost, 'rowEstimate', p.prorows,
    'supportOid', p.prosupport::oid::text, 'variadicOid', p.provariadic::text, 'nargs', p.pronargs, 'argDefaults', p.pronargdefaults,
    'argTypes', p.proargtypes::text, 'allArgTypes', p.proallargtypes, 'argModes', p.proargmodes, 'argNames', p.proargnames,
    'argDefaultsExpr', p.proargdefaults::text, 'transformTypes', p.protrftypes, 'binary', p.probin,
    'sqlBody', p.prosqlbody::text, 'configuration', p.proconfig, 'acl', p.proacl::text[])`,
  "pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang",
  `p.pronamespace = pg_catalog.to_regnamespace('public') AND p.proname IN (${names("guards")}) AND p.pronargs = 0`, "p.proname");
  return `SELECT pg_catalog.jsonb_build_object(
    'version', pg_catalog.current_setting('server_version_num')::int, 'nonce', ${sqlLiteral(nonce)},
    'isolation', pg_catalog.current_setting('transaction_isolation'),
    'deparsePremises', ${schema205DeparsePremisesSql()},
    'publicOid', pg_catalog.to_regnamespace('public')::oid::text,
    'tempOid', pg_catalog.pg_my_temp_schema()::text,
    'currentOwnerOid', current_user::pg_catalog.regrole::oid::text,
    'sessionOwnerOid', session_user::pg_catalog.regrole::oid::text,
    'guards', ${guards},
    'actual', pg_catalog.jsonb_build_object(
      'relation', ${relationRow(actual)}, 'columns', ${columns(actual)}, 'triggers', ${triggers(actual)}, 'checks', ${checks(actual)}),
    'expected', pg_catalog.jsonb_build_object(
      'relation', ${relationRow(expected)}, 'columns', ${columns(expected)}, 'triggers', ${triggers(expected)}, 'checks', ${checks(expected)}));`;
}

function renderCurrent259SevenPreimage(nonce) {
  need(validNonce(nonce), "nonce");
  const recipe = sourceRecipe();
  const columnDefinitions = recipe.columns.map(({ name, sqlType }) =>
    '"' + name + '" ' + sqlType + (NOT_NULL.has(name) ? " NOT NULL" : ""));
  const create = `CREATE TEMP TABLE ${TEMP} (\n  ${columnDefinitions.join(",\n  ")}\n) ON COMMIT DROP;`;
  const checks = recipe.checks.map(check =>
    `ALTER TABLE ${TEMP} ADD CONSTRAINT "${check.name}" CHECK (${check.expression})${check.validated ? "" : " NOT VALID"};`);
  const triggers = recipe.triggers.map(trigger =>
    `CREATE TRIGGER "${trigger.name}" BEFORE ${trigger.event} ON ${TEMP}
  FOR EACH ROW WHEN (${trigger.when}) EXECUTE FUNCTION public.${trigger.guard}();`);
  const requireTransaction = `DO $jg_current259_seven$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'serializable'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off'
     OR pg_catalog.current_setting('server_version_num')::int / 10000 <> 16
     OR current_user <> 'jg_task01_owner' OR current_user <> session_user THEN
    RAISE EXCEPTION USING MESSAGE = 'TASK16_CURRENT259_SEVEN_PREIMAGE', ERRCODE = '55000';
  END IF;
END
$jg_current259_seven$;`;
  const lock = `LOCK TABLE ONLY ${PUBLIC} IN ACCESS EXCLUSIVE MODE;`;
  return Object.freeze({
    setupSql: [requireTransaction, SCHEMA205_DEPARSE_LOCAL, lock, create, ...checks, ...triggers].join("\n"),
    witnessSql: witnessSql(recipe, nonce),
    cleanupSql: `DROP TABLE ${TEMP};`,
  });
}


const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validNonce = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const validOid = value => typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 0xffffffff;
const nonempty = value => typeof value === "string" && value.length > 0;

function matchFields(row, expected, field, variableFields = []) {
  const fields = [...Object.keys(expected), ...variableFields];
  need(isRecord(row) && Object.keys(row).length === fields.length &&
    fields.every(key => Object.hasOwn(row, key)) &&
    Object.entries(expected).every(([key, value]) => row[key] === value), field);
}

function indexedRows(rows, expected, field) {
  need(Array.isArray(rows) && rows.length === expected.length && rows.every(isRecord), field);
  const byName = new Map(rows.map(row => [row.name, row]));
  need(byName.size === expected.length && expected.every(item => byName.has(item.name)), field);
  return byName;
}

function checkObjectOids(rows, field) {
  const oids = rows.map(row => row.oid);
  need(oids.every(validOid) && new Set(oids).size === rows.length, field);
}

function verifyRelation(side, recipe, identity, functions) {
  matchFields(side, {}, "relation", ["relation", "columns", "checks", "triggers"]);
  const { relation, columns, checks, triggers } = side;
  const { namespaceOid, ownerOid, temporary } = identity;
  matchFields(relation, {
    namespaceOid, ownerOid, kind: "r", persistence: temporary ? "t" : "p", partition: false,
    rowSecurity: false, forceRowSecurity: false, hasInheritance: false,
  }, "relation", ["oid"]);
  need(validOid(relation.oid), "relation");

  const columnByName = indexedRows(columns, recipe.columns, "columns");
  const nameByNumber = new Map();
  for (const { name, typeOid, typmod, collationOid } of recipe.columns) {
    const column = columnByName.get(name);
    matchFields(column, {
      name, typeOid, typmod, collationOid, identity: "", generated: "", notNull: NOT_NULL.has(name),
    }, name, ["number"]);
    need(Number.isInteger(column.number) && column.number > 0 && column.number <= 32767 &&
      !nameByNumber.has(column.number), name);
    nameByNumber.set(column.number, name);
  }

  const checkByName = indexedRows(checks, recipe.checks, "checks");
  checkObjectOids(checks, "checks");
  for (const { name, validated, columnNames } of recipe.checks) {
    const check = checkByName.get(name);
    matchFields(check, {
      name, relationOid: relation.oid, namespaceOid, validated, type: "c", local: true, inheritCount: 0,
      noInherit: false, parentOid: "0", indexOid: "0", referencedRelationOid: "0", deferrable: false,
      initiallyDeferred: false,
    }, name, ["oid", "key", "tree", "expression", "definition"]);
    need(Array.isArray(check.key) && check.key.every(number => nameByNumber.has(number)) &&
      isDeepStrictEqual(check.key.map(number => nameByNumber.get(number)).sort(), columnNames) &&
      nonempty(check.tree) && nonempty(check.expression) && nonempty(check.definition), name);
  }

  const triggerByName = indexedRows(triggers, recipe.triggers, "triggers");
  checkObjectOids(triggers, "triggers");
  for (const { name, type, guard } of recipe.triggers) {
    const trigger = triggerByName.get(name);
    matchFields(trigger, {
      name, relationOid: relation.oid, functionOid: functions.get(guard).oid, type, enabled: "O", internal: false,
      parentOid: "0", constraintOid: "0", constraintRelationOid: "0", indexOid: "0", nargs: 0, args: "",
      columns: "", deferrable: false, initiallyDeferred: false, oldTable: null, newTable: null,
    }, name, ["oid", "qualifier", "definition", "when"]);
    need(nonempty(trigger.qualifier) && nonempty(trigger.when) && nonempty(trigger.definition), name);
  }

  return { checkByName, triggerByName };
}

function freezeJson(value) {
  if (value !== null && typeof value === "object") {
    for (const field of Object.values(value)) freezeJson(field);
    Object.freeze(value);
  }
  return value;
}

/**
 * Compare one fixed-query response. The reference rows must be obtained via the
 * renderer in the same owner transaction as the actual rows. JSON alone does
 * not prove that this happened or grant install authority.
 */
function parseCurrent259SevenPreimage(json, ownerOid, nonce) {
  need(typeof json === "string", "observation");
  need(Buffer.byteLength(json) <= MAX_PREIMAGE_BYTES, "observation", "SIZE_LIMIT");
  need(validOid(ownerOid) && validNonce(nonce), "observation");
  let observation;
  try {
    observation = JSON.parse(json);
  } catch {
    need(false, "observation");
  }
  matchFields(observation, {
    nonce, isolation: "serializable", deparsePremises: true, currentOwnerOid: ownerOid, sessionOwnerOid: ownerOid,
  }, "observation", ["version", "publicOid", "tempOid", "guards", "actual", "expected"]);
  const { version, publicOid, tempOid, guards, actual, expected } = observation;
  need(Number.isInteger(version) && version >= 160000 && version < 170000 &&
    validOid(publicOid) && validOid(tempOid) && publicOid !== tempOid, "observation");

  const recipe = sourceRecipe();
  const functions = indexedRows(guards, recipe.guards, "guards");
  checkObjectOids(guards, "guards");
  for (const { name, bodySha256 } of recipe.guards) {
    const guard = functions.get(name);
    matchFields(guard, {
      name, namespaceOid: publicOid, ownerOid, bodySha256, language: "plpgsql", kind: "f", returnTypeOid: "2279",
      securityDefiner: false, strict: false, returnsSet: false, leakproof: false, volatility: "v", parallel: "u",
      cost: 100, rowEstimate: 0, supportOid: "0", variadicOid: "0", nargs: 0, argDefaults: 0, argTypes: "",
      allArgTypes: null, argModes: null, argNames: null, argDefaultsExpr: null, transformTypes: null, binary: null,
      sqlBody: null, configuration: null,
    }, name, ["oid", "acl"]);
    need(guard.acl === null || (Array.isArray(guard.acl) && guard.acl.every(nonempty)), name);
  }

  const actualRows = verifyRelation(actual, recipe, { namespaceOid: publicOid, ownerOid, temporary: false }, functions);
  const expectedRows = verifyRelation(expected, recipe, { namespaceOid: tempOid, ownerOid, temporary: true }, functions);
  need(actual.relation.oid !== expected.relation.oid, "relation");
  for (const { name } of recipe.checks) {
    const check = actualRows.checkByName.get(name);
    const reference = expectedRows.checkByName.get(name);
    need(check.oid !== reference.oid && check.expression === reference.expression &&
      check.definition === reference.definition, name);
  }
  for (const { name } of recipe.triggers) {
    const trigger = actualRows.triggerByName.get(name);
    const reference = expectedRows.triggerByName.get(name);
    need(trigger.oid !== reference.oid && trigger.when === reference.when, name);
  }

  return freezeJson({ nonce, version, publicOid, ownerOid, guards, actual });
}

module.exports = Object.freeze({ renderCurrent259SevenPreimage, parseCurrent259SevenPreimage, describeCurrent259SevenPreimageFailure });
