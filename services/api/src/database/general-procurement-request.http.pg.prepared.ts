/** PREPARED / NOT RUN. Import performs no resource, database, SQL or HTTP work.
 * A separately authorized PG16 harness must supply real JWT HTTP, current signatures,
 * isolated accounts and the newly applied migration; synthetic adapters do not prove these cases.
 */
import assert = require("node:assert/strict");
type Actor = "applicant" | "directorA" | "directorB" | "manager";
type Reply<T> = { status: number; body: T };
type Detail = { revision: number; status: string; projectId: string | null; requestedAmountCents: string | null;
  lines: Array<{ name: string; quantity: string | null; unitPrice: string | null; estimatedAmount: string | null }>;
  approvals: Array<{ actions: Array<{ action: string }> }> };
export interface PreparedGeneralRequestPgHttp {
  /** Create through POST /general-procurements, with only name known; return the public ID. */
  create(scope: "project" | "company_daily"): Promise<Reply<{ id: string; revision: number }>>;
  submit(id: string, revision: number): Promise<Reply<{ revision: number }>>;
  detail(id: string): Promise<Reply<Detail>>;
  review(id: string, actor: Actor, body: { revision: number; expectedNodeIndex: number; decision: "approve" | "return"; comment?: string }): Promise<Reply<unknown>>;
  /** The independently authorized PG constraint boundary, executed in a rolled-back isolated transaction. */
  invalidV2MissingNameConstraintCode(): Promise<string>;
  readPersistedNullableFacts(id: string): Promise<{ projectId: string | null; companyEntityId: string | null; requestedAmountCents: string | null; quantity: string | null }>;
}
export const PREPARED_GENERAL_REQUEST_PG_CASES = ["company-null-and-constraint", "same-duty-competition", "last-decision-competition"] as const;
export async function runPreparedGeneralRequestPgCase(http: PreparedGeneralRequestPgHttp, scenario: typeof PREPARED_GENERAL_REQUEST_PG_CASES[number]) {
  const created = await http.create(scenario === "company-null-and-constraint" ? "company_daily" : "project");
  assert.equal(created.status, 201); const id = created.body.id;
  if (scenario === "company-null-and-constraint") {
    const detail = await http.detail(id); assert.equal(detail.status, 200);
    assert.equal(detail.body.projectId, null); assert.equal(detail.body.requestedAmountCents, null);
    assert.deepEqual(await http.readPersistedNullableFacts(id), { projectId: null, companyEntityId: null, requestedAmountCents: null, quantity: null });
    assert.equal(await http.invalidV2MissingNameConstraintCode(), "23514");
    return;
  }
  const submitted = await http.submit(id, created.body.revision); assert.equal(submitted.status, 201);
  if (scenario === "same-duty-competition") {
    const replies = await Promise.all(["directorA", "directorB"].map(actor => http.review(id, actor as Actor, { revision: submitted.body.revision, expectedNodeIndex: 0, decision: "approve" })));
    assert.deepEqual(replies.map(reply => reply.status).sort(), [201, 409]);
    const detail = await http.detail(id); assert.equal(detail.body.status, "approval_pending");
    assert.equal(detail.body.approvals[0].actions.filter(action => action.action === "approve").length, 1);
    return;
  }
  assert.equal((await http.review(id, "directorA", { revision: submitted.body.revision, expectedNodeIndex: 0, decision: "approve" })).status, 201);
  const before = await http.detail(id);
  const replies = await Promise.all([
    http.review(id, "manager", { revision: before.body.revision, expectedNodeIndex: 1, decision: "approve" }),
    http.review(id, "manager", { revision: before.body.revision, expectedNodeIndex: 1, decision: "return", comment: "实际需求待核对" })
  ]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [201, 409]);
  const after = await http.detail(id);
  assert.ok(["approved_pending_procurement", "returned"].includes(after.body.status));
  assert.equal(after.body.revision, before.body.revision + 1);
}
