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

test("life seed renders only exact master data, gives all eight actors distinct credentials and requires an independent committed read", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createCurrent261LocalLifecycleSeed } = require("../../prisma/task12-current259-q2-seed.cjs");
  const fixture = buildTask12LocalLifecycleFixture("12345678-1234-4234-8234-123456789012");
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
  await expect(createTask12LocalLifecycleOriginals({ ...fixture })).rejects.toThrow(/FIXTURE/u);
  const originals: readonly Buffer[] = await createTask12LocalLifecycleOriginals(fixture);
  expect(originals).toHaveLength(2);
  expect(originals.every(bytes => Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length < 512 * 1024)).toBe(true);
  expect(originals[0].equals(originals[1])).toBe(false);
});
