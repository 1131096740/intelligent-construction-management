"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomBytes } = require("node:crypto");

const commit = "ee7a215f530f553949bb57cd029587e490bf9c84";
const tree = "d1cd9e6246c915cdfa48be44b672e09102b59c8b";
const seal = "8ae09674e72061cab1a5e4e0035aa0b79d18381bee2ed22d704402e59789f679";
const subsetSha = "5c4871e8e9fa2d32bf88ea1147523c5eebc67c04a5fe43794ca996a26e46373a";
const capturedArchives = new WeakSet();
const nativeInstallations = new WeakMap();

function captureArchive(admission, digest, source, { file, hash }) {
  const packet = JSON.parse(file(admission, digest));
  assert.equal(packet.mode, "SEALED_FULL_METADATA_EXACT_INSTALLER_CLOSURE");
  assert.equal(hash(packet.subsetManifest), subsetSha);
  const material = JSON.parse(packet.subsetManifest);
  assert.equal(material.scope, "TASK12_B6_B7_263_INSTALLER_SOURCE_ONLY");
  assert.equal(material.historical.commit, commit);
  assert.equal(material.historical.tree, tree);
  assert.equal(material.historical.fullSeal, seal);
  assert.equal(material.selected.length, 318);
  const base = path.join(path.dirname(admission), "source");
  for (const row of material.selected) {
    const candidate = path.resolve(base, row.path);
    assert.ok(candidate.startsWith(base + path.sep));
    assert.equal(file(candidate, row.sha256).length, row.bytes);
  }
  const schema = material.selected.find(row => row.path === "services/api/prisma/schema.prisma");
  assert.ok(schema);
  const migrations = source.ledger.slice(0, 263).map(({ name, sha256 }) => ({ path: "services/api/prisma/migrations/" + name + "/migration.sql", sha256 }));
  for (const migration of migrations) {
    assert.ok(material.selected.some(row => row.path === migration.path && row.sha256 === migration.sha256));
  }
  const fromArchive = createRequire(path.join(base, schema.path));
  const profile = fromArchive("./task16-current259-profile.cjs").qualifyCurrent259Source({
    candidateSha: commit, sealSha256: seal, schemaSha256: schema.sha256, migrations
  });
  assert.equal(profile.profile, "TASK12_ARCHIVE263_SOURCE_V1");
  assert.equal(profile.ledgerSha256, material.historical.ledgerSha256);
  const archive = Object.freeze({ fromArchive, source: Object.freeze({ candidateSha: commit, tree, sourceSealSha256: seal, profile }) });
  capturedArchives.add(archive);
  return archive;
}

function installArchive(archive, sql, runId, port, app, stage) {
  assert.ok(capturedArchives.has(archive), "NATIVE_ARCHIVE_CAPTURE_REQUIRED");
  const identity = JSON.parse(sql(`
    SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,
      'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,
      'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
      'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'clientAddress',host(inet_client_addr()),
      'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port())
    FROM pg_database d WHERE d.datname=current_database();
  `));
  const { fromArchive, source } = archive;
  const role = fromArchive("./task16-current259-role-provision.cjs");
  const roleScope = JSON.stringify({ identity, app, ledger: source.profile.ledger, competition: false });
  const run = (label, statement) => {
    stage(label);
    return sql(statement);
  };
  const before = run("ARCHIVE_ROLE_BEFORE", role.renderNativeTask16RoleRead(app.oid, null));
  role.parseNativeTask16RoleRead(roleScope, before, "before");
  const credentials = { runtime: randomBytes(48).toString("hex"), observer: randomBytes(48).toString("hex") };
  const staged = run("ARCHIVE_ROLE_WRITE", role.renderNativeTask16RoleInstall(roleScope, before, credentials));
  const { writeXid } = role.parseNativeTask16RoleRead(roleScope, staged, "install", before);
  const committed = run("ARCHIVE_ROLE_COMMIT", role.renderNativeTask16RoleRead(app.oid, writeXid));
  const { state } = role.parseNativeTask16RoleRead(roleScope, committed, "committed", before, staged);
  const completion = { status: "CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION", executionAllowed: false, nativeAdmission: false,
    sourceSha: source.candidateSha, runId, databaseIdentity: identity, ordinary: state.app, roles: state.roles, commitXid: writeXid,
    databaseAcl: { before: JSON.parse(before).state.databases, after: state.databases } };
  const archiveModule = fromArchive("./task16-current259-archive-install.cjs");
  const protocol = archiveModule.beginNativeTask12ArchiveProtocol(JSON.stringify({ source, completion, serverPort: port }));
  const seven = protocol.acceptBefore(run("ARCHIVE_BEFORE", protocol.beforeSql));
  const writer = seven.acceptBefore(run("ARCHIVE_SEVEN_BEFORE", seven.beforeSql));
  const reader = writer.acceptWritten(run("ARCHIVE_SEVEN_WRITE", writer.sql));
  const result = reader.acceptCommitted(run("ARCHIVE_SEVEN_COMMITTED", reader.sql));
  assert.equal(result.status, "NATIVE_TASK12_ARCHIVE_SOURCE_MATCHED_NOT_ADMISSION");
  const evidence = { source: source.candidateSha, ledgerSha256: source.profile.ledgerSha256, roles: state.roles.length,
    sevenCatalogSha256: result.sevenCatalogSha256, bindingSha256: result.bindingSha256 };
  nativeInstallations.set(evidence, () => {
    const { completion } = archiveModule.readNativeTask12ArchiveProjection(result);
    return Object.freeze({ owner: completion.databaseIdentity, application: completion.ordinary });
  });
  return evidence;
}

function readOwnedNativeArchiveIdentity(evidence) {
  const readIdentity = nativeInstallations.get(evidence);
  assert.ok(readIdentity, "NATIVE_ARCHIVE_LIVE_INSTALLATION_REQUIRED");
  return readIdentity();
}

module.exports = { captureArchive, installArchive, readOwnedNativeArchiveIdentity };
