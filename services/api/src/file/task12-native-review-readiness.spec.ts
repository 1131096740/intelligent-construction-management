import { reviewReferenceCatalog } from "./contract-review-file-retention";
import { issueTask12NativeReviewReadiness, withTask12NativeReviewReadiness } from "./task12-native-review-readiness";

const identity = {
  database: "jg_task01_" + "1".repeat(32), databaseOid: "12345", ordinaryOid: "23456",
  ordinaryName: "jg_fixture_app_" + "2".repeat(24), serverPort: 44444, systemIdentifier: "7200000000000000001"
};
const owner = { ...identity, ownerOid: "10", ownerSession: true, ssl: true, completed: true };
const actual = { ...identity, sessionRole: true, ssl: true };
function fixture(state = "ready", session = actual) {
  const query = jest.fn().mockResolvedValueOnce([{ state, ...session }]).mockResolvedValueOnce([{ completed: false }]);
  return { query, tx: { $queryRaw: query } as never };
}
it("uses only scoped matching ready ticket evidence and refuses a mismatched transaction", async () => {
  const proof = issueTask12NativeReviewReadiness(identity, owner, () => {});
  await withTask12NativeReviewReadiness(proof, async () => {
    const ticket = fixture();
    await expect(reviewReferenceCatalog(ticket.tx, "ticket")).resolves.toBe("ready");
    expect(ticket.query).toHaveBeenCalledTimes(1);

    const foreign = fixture("ready", { ...actual, databaseOid: "98765" });
    await expect(reviewReferenceCatalog(foreign.tx, "ticket")).rejects.toThrow();
    expect(foreign.query).toHaveBeenCalledTimes(1);

    const noTls = fixture("ready", { ...actual, ssl: false });
    await expect(reviewReferenceCatalog(noTls.tx, "ticket")).rejects.toThrow();
    const legacy = fixture("legacy");
    await expect(reviewReferenceCatalog(legacy.tx, "ticket")).rejects.toThrow();
    const cleanup = fixture();
    await expect(reviewReferenceCatalog(cleanup.tx, "cleanup")).rejects.toThrow();
    expect(cleanup.query).toHaveBeenCalledTimes(2);
  });
  const outside = fixture();
  await expect(reviewReferenceCatalog(outside.tx, "ticket")).rejects.toThrow();
  expect(outside.query).toHaveBeenCalledTimes(2);
  expect(() => issueTask12NativeReviewReadiness(identity, { ...owner, completed: false }, () => {})).toThrow();
  expect(() => issueTask12NativeReviewReadiness(identity, { ...owner, databaseOid: "98765" }, () => {})).toThrow();
});

it("scopes approval row locks to the bound applicant and project", async () => {
  const { task12NativeApprovalAssignments } = await import("./task12-native-review-readiness");
  const project = "11111111-1111-4111-a111-111111111111";
  const applicant = "22222222-2222-4222-a222-222222222222";
  const query = jest.fn().mockResolvedValue([{ assignments: { project: [], global: [] } }]);
  const tx = { $queryRaw: query } as never;
  expect(await task12NativeApprovalAssignments(tx, "applicant", project, applicant)).toBeUndefined();
  const proof = issueTask12NativeReviewReadiness({ ...identity, project, applicant }, owner, () => {});
  await withTask12NativeReviewReadiness(proof, async () => {
    await expect(task12NativeApprovalAssignments(tx, "applicant", "other", applicant)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    await expect(task12NativeApprovalAssignments(tx, "candidates", project, applicant))
      .resolves.toEqual({ project: [], global: [] });
  });
});

it("locks only declared review role filters and the current seal authority on the bound scope", async () => {
  const { task12NativeApprovalAssignments, task12NativeSealAssignments } = await import("./task12-native-review-readiness");
  const project = "11111111-1111-4111-a111-111111111111";
  const applicant = "22222222-2222-4222-a222-222222222222";
  const reviewer = "33333333-3333-4333-a333-333333333333";
  const query = jest.fn().mockResolvedValue([{ assignments: { project: [], global: [] } }]);
  const tx = { $queryRaw: query } as never;
  const scope = issueTask12NativeReviewReadiness({ ...identity, project, applicant }, owner, () => {});
  await withTask12NativeReviewReadiness(scope, async () => {
    await expect(task12NativeApprovalAssignments(tx, "review", project, reviewer, [], ["contract_director", "super_admin"]))
      .resolves.toEqual({ project: [], global: [] });
    await expect(task12NativeSealAssignments(tx, reviewer)).resolves.toEqual({ project: [], global: [] });
  });
  expect(query.mock.calls.map(([request]) => request.values)).toEqual([
    [project, reviewer, "review", [], ["contract_director", "super_admin"]],
    [project, reviewer, "seal", [], ["comprehensive_director", "super_admin"]]
  ]);
});

it("reads the bound current signature only within the scoped review transaction", async () => {
  const { task12NativeApprovalSignature } = await import("./task12-native-review-readiness");
  const project = "11111111-1111-4111-a111-111111111111";
  const actor = "33333333-3333-4333-a333-333333333333";
  const signature = { id: "id", fileId: "file", contentSha256: "a".repeat(64) };
  const query = jest.fn().mockResolvedValueOnce([signature]).mockResolvedValueOnce([]);
  const tx = { $queryRaw: query };
  expect(await task12NativeApprovalSignature(tx, project, actor)).toBeUndefined();
  const proof = issueTask12NativeReviewReadiness({ ...identity, project }, owner, () => {});
  await withTask12NativeReviewReadiness(proof, async () => {
    await expect(task12NativeApprovalSignature(tx, "foreign", actor)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    await expect(task12NativeApprovalSignature(tx, project, actor)).resolves.toEqual(signature);
    await expect(task12NativeApprovalSignature(tx, project, actor)).resolves.toBeNull();
  });
  expect(query.mock.calls.map(([request]) => request.values)).toEqual([[project, actor], [project, actor]]);
});
