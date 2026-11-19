import { buildTask12LocalLifecycleFixture, createTask12LocalLifecycleOriginals } from "./task12-local-lifecycle-fixture";

test("local lifecycle fixes all eight actors and only the five master-data rows required by the public inside material case", () => {
  const fixture = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012");
  expect(fixture.approval.users).toHaveLength(8);
  expect(fixture.master.CompanyEntity).toHaveLength(1);
  expect(fixture.master.CompanyEntityVersion[0]).toMatchObject({ companyEntityId: fixture.master.CompanyEntity[0].id, versionNo: 1 });
  expect(fixture.master.ProjectParticipatingCompany[0]).toMatchObject({ projectId: fixture.approval.project.id, companyEntityId: fixture.master.CompanyEntity[0].id, companyEntityVersionId: fixture.master.CompanyEntityVersion[0].id });
  expect(fixture.master.BusinessPartyVersion[0].businessPartyId).toBe(fixture.master.BusinessParty[0].id);
  expect(Object.keys(fixture.master).sort()).toEqual(["BusinessParty", "BusinessPartyVersion", "CompanyEntity", "CompanyEntityVersion", "ProjectParticipatingCompany"]);
  expect(fixture.approval.project.operatingLedgerEffectiveDate).toBeNull();
  expect(Object.isFrozen(fixture.master.CompanyEntity[0])).toBe(true);
});

for (const caseKey of ["inside:material_purchase", "inside:equipment_rental"]) test("life seed retains exact master data and independent committed read for " + caseKey, () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createCurrent261LocalLifecycleSeed } = require("../../prisma/task12-current259-q2-seed.cjs");
  const fixture = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012", caseKey);
  const identity = { database: "jg_task01_" + "a".repeat(32), databaseOid: "200", namespaceOid: "2200", ownerOid: "10", actorOid: "10",
    actor: "jg_task01_owner", sessionActor: "jg_task01_owner", systemIdentifier: "1234", tls: true, clientAddress: "127.0.0.1", serverAddress: "127.0.0.1", serverPort: 5432 };
  const hashes = Object.fromEntries(fixture.approval.users.map((user, i) => [user.id, "$2b$10$" + String.fromCharCode(97 + i).repeat(53)]));
  const seed = createCurrent261LocalLifecycleSeed(fixture, identity, hashes);
  const row = (sql: string, phase: string, pid: number) => JSON.stringify({ phase, nonce: sql.match(/'nonce','([a-f0-9]{64})'/u)![1], identity,
    backend: { pid, start: `2026-11-13T00:00:00.000${pid}Z` }, readOnly: phase !== "write", isolation: phase === "write" ? "serializable" : "repeatable read",
    writeXid: phase === "write" ? "803" : null, commitStatus: phase === "committed" ? "committed" : null, matches: true });
  const before = seed.beforeSql(); seed.verifyBefore(row(before, "before", 100));
  const sql = seed.writeSql();
  expect((sql.match(/^INSERT INTO /gmu) ?? [])).toHaveLength(26);
  expect((sql.match(/^INSERT INTO public\."User"/gmu) ?? [])).toHaveLength(8);
  expect(sql).not.toMatch(/^INSERT INTO public\."(?:Contract|Approval|FileObject|OperatingFact)/mu);
  expect(sql).toContain("a.pid<>pg_backend_pid()");
  seed.verifyWritten(row(sql, "write", 101));
  const committed = seed.committedSql();
  expect(seed.finish(row(committed, "committed", 102))).toEqual({ seedRows: 26, operating: false, seedXid: "803" });
  expect(() => createCurrent261LocalLifecycleSeed(fixture, identity, { ...hashes, [fixture.approval.users[7].id]: hashes[fixture.approval.users[0].id] })).toThrow(/INPUT/u);
});

it("creates only the two declared local PDF originals for its own private fixture", async () => {
  const fixture = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012");
  await expect(createTask12LocalLifecycleOriginals({ ...fixture })).rejects.toThrow("本地验收数据来源无效");
  const originals: readonly Buffer[] = await createTask12LocalLifecycleOriginals(fixture);
  expect(originals).toHaveLength(2);
  expect(originals.every(bytes => Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length < 512 * 1024)).toBe(true);
  expect(originals[0].equals(originals[1])).toBe(false);
});


test("equipment fixture retains its source case binding and genuine inside approval roles", () => {
  const equipment = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012", "inside:equipment_rental");
  expect(equipment.case).toMatchObject({ key: "inside:equipment_rental", contractTypeKey: "equipment_rental", relationship: "inside", billAlias: "equipmentRentals" });
  expect(equipment.approval.users).toHaveLength(8);
  expect(equipment.approval.globalRoles.map(row => row.roleKey)).toEqual(["material_director", "contract_director", "finance_director", "general_manager", "comprehensive_director"]);
  expect(equipment.approval.project.operatingLedgerEffectiveDate).toBeNull();
  const material = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012");
  expect(material.case.contractTypeKey).toBe("material_purchase");
  expect(equipment.case).not.toEqual(material.case);
  expect(equipment.approval.project.id).not.toBe(material.approval.project.id);
  expect(equipment.approval.users[0].id).not.toBe(material.approval.users[0].id);
  expect(equipment.master.CompanyEntity[0].id).not.toBe(material.master.CompanyEntity[0].id);
  expect(() => buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012", "inside:unknown")).toThrow(/CASE_UNKNOWN/u);
});

test("fixed native equipment seed binds the actual non5432 owner endpoint and keeps legacy seed rejection", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createNativeCurrent261EquipmentSeed, createCurrent261LocalLifecycleSeed } = require("../../prisma/task12-current259-q2-seed.cjs");
  const fixture = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012", "inside:equipment_rental");
  const identity = { database: "jg_task01_" + "a".repeat(32), databaseOid: "200", namespaceOid: "2200", ownerOid: "10", actorOid: "10", actor: "jg_task01_owner", sessionActor: "jg_task01_owner", systemIdentifier: "1234", tls: true, clientAddress: "127.0.0.1", serverAddress: "127.0.0.1", serverPort: 55432 };
  const hashes = Object.fromEntries(fixture.approval.users.map((user, i) => [user.id, "$2b$10$" + String.fromCharCode(97 + i).repeat(53)]));
  expect(() => createCurrent261LocalLifecycleSeed(fixture, identity, hashes)).toThrow(/INPUT/u);
  const seed = createNativeCurrent261EquipmentSeed(fixture, identity, hashes);
  const row = (sql: string, phase: string, pid: number) => JSON.stringify({ phase, nonce: sql.match(/'nonce','([a-f0-9]{64})'/u)![1], identity, backend: { pid, start: `2026-11-13T00:00:00.000${pid}Z` }, readOnly: phase !== "write", isolation: phase === "write" ? "serializable" : "repeatable read", writeXid: phase === "write" ? "803" : null, commitStatus: phase === "committed" ? "committed" : null, matches: true });
  const before = seed.beforeSql();seed.verifyBefore(row(before, "before", 100));
  const write = seed.writeSql();expect((write.match(/^INSERT INTO /gmu) ?? [])).toHaveLength(26);
  expect(write).toContain('"serverPort":55432');seed.verifyWritten(row(write, "write", 101));
  expect(seed.finish(row(seed.committedSql(), "committed", 102))).toEqual({ seedRows: 26, operating: false, seedXid: "803" });
  expect(() => createNativeCurrent261EquipmentSeed(fixture, { ...identity, serverPort: 5432 }, hashes)).toThrow(/INPUT/u);
});
