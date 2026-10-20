/** Prisma boundary fixture shared by domain approval tests. No approval function is mocked. */
export function approvalEvidenceDatabaseFixture() {
  let instance: Record<string, unknown> | null = null;
  const actions: Record<string, unknown>[] = [];
  const delegates = {
    approvalInstance: {
      findFirst: jest.fn(async () => instance),
      create: jest.fn(async ({ data }) => (instance = { id: "evidence-instance-1", ...data })),
      update: jest.fn(async ({ data }) => (instance = { ...instance, ...data }))
    },
    approvalActionLog: { create: jest.fn(async ({ data }) => {
      const action = { id: `evidence-action-${actions.length + 1}`, ...data };
      actions.push(action); return action;
    }) },
    user: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, isActive: true, name: "签批人甲" })) }
  };
  function query(signatureQuery: { strings: readonly string[]; values: readonly unknown[] }) {
    const sql = signatureQuery.strings.join("?");
    if (sql.trim().startsWith('SELECT "id", "isActive", "name"')) return [{ id: signatureQuery.values[0], isActive: true, name: "签批人甲" }];
    if (sql.trim().startsWith('SELECT "id", "fileId", "contentSha256"') && sql.includes('FROM "HandwrittenSignatureVersion"')) return [{ id: "signature-version-1", fileId: "signature-file-1", contentSha256: "a".repeat(64) }];
    if (sql.includes('FROM "FileObject"') && sql.includes('"storageStatus"') && signatureQuery.values[0] === "signature-file-1") return [{ id: "signature-file-1", storageStatus: "active", contentSha256: "a".repeat(64) }];
    return undefined;
  }
  return { delegates, query, actions, seedInstance: (value: Record<string, unknown>) => { instance = value; } };
}

/** Extend domain database doubles with real evidence persistence, without mocking the evidence service. */
export function attachApprovalEvidenceFixture(tx: Record<string, unknown> & { $queryRaw?: jest.Mock }) {
  const evidence = approvalEvidenceDatabaseFixture();
  tx.approvalInstance = evidence.delegates.approvalInstance;
  tx.approvalActionLog = evidence.delegates.approvalActionLog;
  if (!tx.user) tx.user = evidence.delegates.user;
  const original = tx.$queryRaw?.getMockImplementation();
  if (!tx.$queryRaw) tx.$queryRaw = jest.fn();
  tx.$queryRaw.mockImplementation((sql: { strings: readonly string[]; values: readonly unknown[] }) =>
    Promise.resolve(evidence.query(sql) ?? original?.(sql) ?? []));
  return evidence;
}

/** Add only signature SQL rows to legacy approval database doubles. Keep business persistence untouched. */
export function attachApprovalSignatureFixture(tx: Record<string, unknown> & { $queryRaw?: jest.Mock }) {
  const evidence = approvalEvidenceDatabaseFixture();
  const original = tx.$queryRaw;
  tx.$queryRaw = jest.fn((sql) => Promise.resolve(evidence.query(sql) ?? original?.(sql) ?? []));
}
