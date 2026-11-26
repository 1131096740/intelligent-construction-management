"use strict";

const assert = require("node:assert/strict");
const { readOwnedNativeArchiveIdentity } = require("../prisma/seal-retirement-329-archive.cjs");

const profiles = Object.freeze({
  outside: { table: "jg_a08_outside_original_pair_v1", routine: "jg_check_a08_outside_original_pair_v1(text,text,text,integer)",
    body: "1e2a2c2eb9191178796cac4c10dad4f9c5a09403584fbe47d8e7be00a9b7f802", protocol: "1", count: 2 },
  upward: { table: "jg_a08_direct_original_voucher_binding_v1", routine: "jg_check_a08_direct_original_voucher_v1(text,text)",
    body: "d81674e3e0e51236d4927b11a3c90c59b1d385fd01044f0cde1604d05c115ab3", protocol: "2", count: 1 }
});
const genericVoucherRoutine = "jg_project_owner_settlement_voucher_bound(text)";
const scopeTables = Object.values(profiles).map(({ table }) => `public.${table}`);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const fieldNames = row => Object.keys(row).map(column => `"${column}"`).join(", ");
const claimTxid = profile => profile === profiles.outside ? " - 'claim_xid'" : "";

function prepareA08OriginalAssociation(archiveMaterial, { relationship, contractId, versionId, projectId, applicantId, saveKey, files }) {
  const { owner, application } = readOwnedNativeArchiveIdentity(archiveMaterial);
  const profile = profiles[relationship];
  assert.ok(relationship === "outside" || relationship === "upward");
  assert.ok(Number.isInteger(owner.serverPort) && owner.serverPort > 1024 && owner.serverPort <= 65535 && owner.serverPort !== 5432);
  assert.match(application.name, /^jg_fixture_app_[a-f0-9]{24}$/u);
  assert.match(application.oid, /^[1-9][0-9]{0,9}$/u);
  assert.ok(Number(application.oid) <= 0xFFFFFFFF && application.oid !== "10");
  [contractId, versionId, projectId, applicantId, saveKey].forEach(id => assert.match(id, uuid));
  assert.equal(files.length, profile.count);
  assert.equal(new Set(files.map(file => file.id)).size, profile.count);
  const objects = files.map((file, index) => {
    const originalName = `synthetic-signed-original-0${relationship === "outside" ? index + 1 : 2}.pdf`;
    assert.match(file.id, uuid);
    assert.match(file.bucket, /^[a-z0-9-]{1,63}$/u);
    assert.equal(file.objectKey, `a08-offline-fixture/${originalName}`);
    assert.equal(file.originalName, originalName);
    assert.equal(file.mimeType, "application/pdf");
    assert.match(file.contentSha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= 104_857_600);
    const { id, bucket, objectKey, mimeType, sizeBytes, contentSha256 } = file;
    return { id, bucket, objectKey, originalName, mimeType, sizeBytes, contentSha256,
      uploadedByUserId: applicantId, storageStatus: "active", purgeReceiptId: null, supersedesFileObjectId: null };
  });
  const exactScope = { singleton: true, database_oid: Number(owner.databaseOid), system_identifier: owner.systemIdentifier,
    server_port: owner.serverPort, ordinary_role_oid: Number(application.oid), project_id: projectId,
    version_id: versionId, applicant_id: applicantId };
  const [first, second] = objects;
  const details = second ? { file_one: first.id, sha_one: first.contentSha256, size_one: first.sizeBytes, mime_one: first.mimeType,
    file_two: second.id, sha_two: second.contentSha256, size_two: second.sizeBytes, mime_two: second.mimeType }
    : { file_id: first.id, content_sha256: first.contentSha256, size_bytes: first.sizeBytes, mime_type: first.mimeType };
  const scope = { ...exactScope, ...details };
  const table = `public.${profile.table}`;
  const otherTable = scopeTables.find(relation => relation !== table);
  const role = `"${application.name}"`;
  const roleOid = `${application.oid}::oid`;
  const applicationRole = `${quote(application.name)}`;

  const endpoint = `current_database()=${quote(owner.database)} AND current_user='jg_task01_owner' AND current_user=session_user
    AND current_user::regrole::oid=10 AND to_regnamespace('public')::oid::text=${quote(owner.namespaceOid)}
    AND EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND oid::text=${quote(owner.databaseOid)} AND datdba=10)
    AND (SELECT system_identifier::text FROM pg_control_system())=${quote(owner.systemIdentifier)}
    AND current_setting('session_replication_role')='origin' AND inet_server_port()=${owner.serverPort}
    AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet
    AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    AND NOT EXISTS(SELECT FROM pg_stat_activity s WHERE s.backend_type='client backend' AND s.pid<>pg_backend_pid()
      AND (s.datname IS DISTINCT FROM current_database() OR s.usesysid IS DISTINCT FROM ${roleOid}))
    AND EXISTS(SELECT FROM pg_roles r WHERE r.oid=${roleOid} AND r.rolname=${applicationRole} AND r.rolcanlogin
      AND NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE r.oid IN (m.roleid,m.member)))`;

  const tablesOwnerOnly = `(SELECT count(*)=2 AND bool_and(c.relowner=10 AND c.relkind='r'
    AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE a.grantee<>10 OR a.grantor<>10)
    AND NOT EXISTS(SELECT FROM pg_attribute column_data CROSS JOIN LATERAL aclexplode(column_data.attacl) a
      WHERE column_data.attrelid=c.oid AND (a.grantee<>10 OR a.grantor<>10))
    AND NOT has_table_privilege(${roleOid},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(${roleOid},c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    FROM pg_class c WHERE c.oid IN (${scopeTables.map(relation => `${quote(relation)}::regclass`).join(",")}))`;

  function exactRoutineAcl(definition, active) {
    const signature = quote(`public.${definition.routine}`);
    const body = definition.body ? `AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=${quote(definition.body)}` : "";
    return `EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure(${signature}) AND p.proowner=10 AND p.prosecdef ${body}
      AND (SELECT count(*)=${active ? 2 : 1} AND count(*) FILTER (WHERE a.grantee=10)=1
        AND bool_and(a.grantor=10 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND ${active ? `a.grantee IN (10,${roleOid})` : "a.grantee=10"})
        FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
      AND has_function_privilege(${roleOid},p.oid,'EXECUTE') IS ${active ? "TRUE" : "FALSE"})`;
  }
  const genericOwnerOnly = exactRoutineAcl({ routine: genericVoucherRoutine }, false);
  const helperOwners = active => [genericOwnerOnly, ...Object.values(profiles).map(definition =>
    exactRoutineAcl(definition, active && definition === profile))].join("\n    AND ");

  function matchesDraft(revision) {
    return `EXISTS (SELECT FROM public."ContractVersion" v JOIN public."Contract" c ON c.id=v."contractId"
      JOIN public."Project" p ON p.id=c."projectId"
      JOIN public."ProjectMember" m ON m."projectId"=p.id AND m."userId"=c."ownerUserId" AND m."positionKey"='contract_staff'
      JOIN public."User" u ON u.id=m."userId" AND u."isActive"
      WHERE v.id=${quote(versionId)} AND v.status='draft' AND v."draftRevision"=${revision}
      AND v."versionNo"=1 AND v."numericProtocolVersion"=2 AND v."changeType"='original'
      AND v."supersedesVersionId" IS NULL AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL AND v."endedAt" IS NULL
      AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
      AND v."draftData"#>>'{directSigningInput,relationship}'=${quote(relationship)}
      AND v."draftData"#>>'{directSigningInput,protocolVersion}'=${quote(profile.protocol)}
      AND c.id=${quote(contractId)} AND c."ownerUserId"=${quote(applicantId)} AND c."contractTypeKey"='material_purchase'
      AND c."voidedAt" IS NULL AND p.id=${quote(projectId)} AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL)`;
  }

  const boundFiles = `(SELECT jsonb_agg(to_jsonb(f)-'createdAt' ORDER BY f.id COLLATE "C") FROM public."FileObject" f)
    IS NOT DISTINCT FROM ${json([...objects].sort((a, b) => a.id < b.id ? -1 : 1))}`;
  const bothScopesEmpty = scopeTables.map(relation => `NOT EXISTS (SELECT FROM ${relation})`).join(" AND ");
  const expectedBindings = objects.map(({ id }, displayOrder) => ({ id, displayOrder }));
  const orderedAttachments = `(SELECT jsonb_agg(jsonb_build_object('id',a."fileId",'displayOrder',a."displayOrder") ORDER BY a."displayOrder")
    FROM public."ContractDraftAttachment" a WHERE a."contractVersionId"=${quote(versionId)}
      AND a."slotKey"='direct_signed_originals_v1' AND a."createdByUserId"=${quote(applicantId)}) IS NOT DISTINCT FROM ${json(expectedBindings)}
    AND (SELECT count(*) FROM public."ContractDraftAttachment" WHERE "contractVersionId"=${quote(versionId)})=${profile.count}`;
  const saveRow = `EXISTS (SELECT FROM public."ContractDraftSaveRequest" r WHERE r."idempotencyKey"=${quote(saveKey)}
      AND r."contractVersionId"=${quote(versionId)} AND r."createdByUserId"=${quote(applicantId)} AND r."saveKind"='manual'
      AND r."expectedRevision"=1 AND r."resultRevision"=2)`;
  const typedScope = `(SELECT to_jsonb(s)${claimTxid(profile)} FROM jsonb_populate_record(NULL::${table},${json(scope)}) s)`;
  const scopeMatch = claimed => `EXISTS (SELECT FROM ${table} b WHERE to_jsonb(b)${claimTxid(profile)}=${typedScope}${second
    ? claimed ? ` AND b.claim_xid IS NOT NULL AND pg_xact_status(b.claim_xid)='committed'
        AND (SELECT count(*) FROM public."ContractDraftAttachment" a WHERE a."contractVersionId"=b.version_id
          AND a.xmin::text::numeric=mod(b.claim_xid::text::numeric,4294967296))=2` : " AND b.claim_xid IS NULL" : ""})
    AND NOT EXISTS (SELECT FROM ${otherTable})`;

  const start = `BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
SET LOCAL search_path TO pg_catalog, public, pg_temp;
SET LOCAL standard_conforming_strings=on;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='5s';
LOCK TABLE public."FileObject", public."ContractDraftAttachment", public."ContractDraftEditLease", public."ContractDraftSaveRequest",
  ${scopeTables.join(", ")} IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public."ContractVersion", public."Contract", public."Project", public."ProjectMember", public."User" IN SHARE MODE NOWAIT;`;
  const guard = (phase, checks) => `DO $a08_original_association$ BEGIN
  IF (${checks.join("\n    AND ")}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A08_ORIGINAL_ASSOCIATION_${phase}'; END IF;
END $a08_original_association$;`;
  const receipt = stage => ({ stage, relationship, originals: profile.count, scopeTablesOwnerOnly: true,
    selectedHelperExecutable: stage === "OPEN", alternateHelperExecutable: false, genericHelperExecutable: false });
  const end = stage => `SELECT ${json(receipt(stage))};\nCOMMIT;`;
  let state = "READY";

  return Object.freeze({
    openSql() {
      assert.equal(state, "READY", "A08_ORIGINAL_ASSOCIATION_ORDER");
      state = "OPEN_SENT";
      const prepare = guard("OPEN_PREIMAGE", [endpoint, tablesOwnerOnly, helperOwners(false), bothScopesEmpty, matchesDraft(1),
        'NOT EXISTS (SELECT FROM public."FileObject")', 'NOT EXISTS (SELECT FROM public."ContractDraftAttachment")',
        `EXISTS (SELECT FROM public."ContractDraftEditLease" WHERE "contractVersionId"=${quote(versionId)}
          AND "holderUserId"=${quote(applicantId)} AND "expiresAt">statement_timestamp())`]);
      const insertFiles = `INSERT INTO public."FileObject" (${fieldNames(first)})
  SELECT ${fieldNames(first)} FROM jsonb_populate_recordset(NULL::public."FileObject",${json(objects)});`;
      const insertScope = `INSERT INTO ${table} (${fieldNames(scope)})
  SELECT ${fieldNames(scope)} FROM jsonb_populate_record(NULL::${table},${json(scope)});`;
      return [start, prepare, insertFiles, insertScope, `GRANT EXECUTE ON FUNCTION public.${profile.routine} TO ${role};`,
        guard("OPEN_POSTIMAGE", [endpoint, tablesOwnerOnly, helperOwners(true), boundFiles, scopeMatch(false)]), end("OPEN")].join("\n");
    },
    acceptOpen(observed) {
      assert.equal(state, "OPEN_SENT", "A08_ORIGINAL_ASSOCIATION_ORDER");
      state = "FAILED";
      assert.deepEqual(observed, receipt("OPEN"), "A08_ORIGINAL_ASSOCIATION_OPEN_RECEIPT");
      state = "OPEN";
    },
    closeSql() {
      assert.equal(state, "OPEN", "A08_ORIGINAL_ASSOCIATION_ORDER");
      state = "CLOSE_SENT";
      return [start, guard("CLOSE_PREIMAGE", [endpoint, tablesOwnerOnly, helperOwners(true), matchesDraft(2), boundFiles, scopeMatch(true),
        saveRow, orderedAttachments]), `REVOKE EXECUTE ON FUNCTION public.${profile.routine} FROM ${role};`,
      `DELETE FROM ${table} WHERE singleton;`,
      guard("CLOSE_POSTIMAGE", [endpoint, tablesOwnerOnly, helperOwners(false), bothScopesEmpty, boundFiles, orderedAttachments]), end("CLOSED")].join("\n");
    },
    acceptClosed(observed) {
      assert.equal(state, "CLOSE_SENT", "A08_ORIGINAL_ASSOCIATION_ORDER");
      state = "FAILED";
      assert.deepEqual(observed, receipt("CLOSED"), "A08_ORIGINAL_ASSOCIATION_CLOSE_RECEIPT");
      state = "CLOSED";
    }
  });
}

module.exports = { prepareA08OriginalAssociation };
