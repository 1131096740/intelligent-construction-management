/** PREPARED / NOT RUN. No resources, SQL, migrations or requests execute on import.
 * A separately authorized PG16 runner must provide isolated accounts/projects/storage,
 * real HTTP auth and freshly submitted applications. Boundary doubles are insufficient.
 */
import assert = require("node:assert/strict");

type Session = "applicant" | "materialsA" | "materialsB" | "manager";
type Coordinates = { expectedVersionId: string; expectedApprovalInstanceId: string; expectedNodeIndex: number };
type Detail = {
  procurement: { status: string };
  reviewApprovalContext: Coordinates | null;
  payments: Array<{ id: string }>;
  approvalTimeline: Array<{ action: string }>;
};
type Reply<T> = { status: number; body: T };
export interface PreparedParallelPgHttp {
  /** Must create and submit via public HTTP, using separate fresh applications per case. */
  createSubmittedApplication(label: string): Promise<string>;
  detail(id: string, session: Session): Promise<Reply<Detail>>;
  review(id: string, session: Session, input: Coordinates & { decision: "approve" | "reject"; comment?: string }): Promise<Reply<unknown>>;
}

export async function runPreparedParallelPgHttpCases(http: PreparedParallelPgHttp): Promise<void> {
  const coordinates = async (id: string, actor: Session) => {
    const reply = await http.detail(id, actor);
    assert.equal(reply.status, 200);
    const current = reply.body.reviewApprovalContext;
    if (!current) throw new Error("当前有效职责必须公开可办");
    return current;
  };
  const detail = async (id: string) => {
    const reply = await http.detail(id, "applicant");
    assert.equal(reply.status, 200);
    return reply.body;
  };
  {
    const id = await http.createSubmittedApplication("parallel-distinct-duties");
    const [materials, manager] = await Promise.all([coordinates(id, "materialsA"), coordinates(id, "manager")]);
    assert.equal(materials.expectedNodeIndex, 0);
    assert.equal(manager.expectedNodeIndex, 1);
    const replies = await Promise.all([
      http.review(id, "materialsA", { ...materials, decision: "approve" }),
      http.review(id, "manager", { ...manager, decision: "approve" })
    ]);
    assert.deepEqual(replies.map(reply => reply.status), [201, 201]);
    const after = await detail(id);
    assert.equal(after.procurement.status, "approved_in_progress");
    assert.equal(after.payments.length, 1, "业务后继唯一");
    assert.equal(after.approvalTimeline.filter(log => log.action === "approve").length, 2);
    assert.equal((await http.review(id, "manager", { ...manager, decision: "approve" })).status, 409);
  }
  {
    const id = await http.createSubmittedApplication("parallel-same-duty-claim");
    const [first, second] = await Promise.all([coordinates(id, "materialsA"), coordinates(id, "materialsB")]);
    const replies = await Promise.all([
      http.review(id, "materialsA", { ...first, decision: "approve" }),
      http.review(id, "materialsB", { ...second, decision: "approve" })
    ]);
    assert.deepEqual(replies.map(reply => reply.status).sort(), [201, 409]);
    const after = await detail(id);
    assert.equal(after.procurement.status, "approval_pending");
    assert.equal(after.payments.length, 0);
    assert.equal(after.approvalTimeline.filter(log => log.action === "approve").length, 1);
  }
  {
    const id = await http.createSubmittedApplication("parallel-last-approve-versus-reject");
    const materials = await coordinates(id, "materialsA");
    assert.equal((await http.review(id, "materialsA", { ...materials, decision: "approve" })).status, 201);
    const manager = await coordinates(id, "manager");
    const replies = await Promise.all([
      http.review(id, "manager", { ...manager, decision: "approve" }),
      http.review(id, "manager", { ...manager, decision: "reject", comment: "竞争驳回，请调整需求" })
    ]);
    assert.deepEqual(replies.map(reply => reply.status).sort(), [201, 409]);
    const beforeLate = await detail(id);
    assert.ok(["draft", "approved_in_progress"].includes(beforeLate.procurement.status));
    assert.equal(beforeLate.payments.length, beforeLate.procurement.status === "draft" ? 0 : 1);
    assert.equal((await http.review(id, "manager", { ...manager, decision: "approve" })).status, 409);
    assert.deepEqual(await detail(id), beforeLate, "旧轮迟到动作不得追加签字或业务后果");
  }
}

/** PREPARED / NOT RUN: submit with automatic transport disabled, then enable only
 * a deterministic gateway adapter and race two service instances over the same PG16.
 * Evidence is observed at the gateway and public progress output, never by DB peeking.
 */
export async function runPreparedParallelNotificationClaimPgCase(input: {
  firstConsumer(): Promise<void>;
  secondConsumer(): Promise<void>;
  gatewayRequestCount(): number;
  publicProgress(): Promise<{history: Array<{action: string}>}>;
}): Promise<void> {
  assert.equal(input.gatewayRequestCount(), 0);
  await Promise.all([input.firstConsumer(), input.secondConsumer()]);
  assert.equal(input.gatewayRequestCount(), 1, "同一轮同一职责同一收件人只能跨网关一次");
  const progress = await input.publicProgress();
  assert.equal(progress.history.filter(log => log.action === "已提交审批通知").length, 1);
  await input.firstConsumer();
  assert.equal(input.gatewayRequestCount(), 1, "已领取的通知不得自动重发");
}
