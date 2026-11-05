/** PREPARED_NOT_EXECUTED. Pure HTTP cases only; importing this file creates no resources or driver. */
import assert = require("node:assert/strict");
type Actor = "applicant" | "director" | "manager";
type Coordinates = {expectedVersionId: string; expectedApprovalInstanceId: string; expectedNodeIndex: number};
type Detail = {procurement: {status: string}; currentVersion: {id: string; draftRevision: number}; lines: Array<{quantity: string | null; unit: string | null; estimatedAmount: string | null}>; reviewApprovalContext: Coordinates; payments: unknown[]; receipt: {available: boolean; currentRevisionNo: number | null}; purchaseTask: {pending: boolean; canHandle: boolean; requiresReceipt: boolean}};
export interface PreparedSpotRequestV2Http {
  projectId: string;
  request(actor: Actor, path: string, method?: string, body?: unknown): Promise<{status: number; body: unknown}>;
}
export async function runPreparedSpotRequestV2HttpCases(http: PreparedSpotRequestV2Http) {
  const call = async (actor: Actor, path: string, method = "GET", body?: unknown, status = 200) => {
    const result = await http.request(actor, path, method, body); assert.equal(result.status, status); return result.body;
  };
  const create = async () => (await call("applicant", "/spot-procurements", "POST", {projectId: http.projectId, lines: [{materialName: "帆布"}]}, 201) as {procurementId: string}).procurementId;
  const read = async (id: string, actor: Actor = "applicant") => await call(actor, `/spot-procurements/${id}`) as Detail;
  const first = await create();
  const initial = await read(first);
  assert.equal(initial.lines[0]!.quantity, null); assert.equal(initial.lines[0]!.unit, null);
  const initialCoordinates = {expectedVersionId: initial.currentVersion.id, expectedDraftRevision: initial.currentVersion.draftRevision};
  const values = {lines: [{materialName: "扎丝", quantity: "1.2345", estimatedUnitPrice: "1.2345"}, {materialName: "铲子"}]};
  await call("applicant", `/spot-procurements/${first}/draft`, "PATCH", {...values, ...initialCoordinates});
  await call("applicant", `/spot-procurements/${first}/draft`, "PATCH", {...values, ...initialCoordinates}, 409);
  const saved = await read(first);
  assert.equal(saved.lines[0]!.estimatedAmount, "1.524"); assert.equal(saved.lines[1]!.quantity, null);
  await call("applicant", `/spot-procurements/${first}/submission`, "POST", {expectedVersionId: saved.currentVersion.id, expectedDraftRevision: saved.currentVersion.draftRevision}, 201);
  const [director, manager] = await Promise.all([read(first, "director"), read(first, "manager")]);
  await Promise.all([
    call("director", `/spot-procurements/${first}/approval`, "POST", {...director.reviewApprovalContext, expectedNodeIndex: 0, decision: "approve"}, 201),
    call("manager", `/spot-procurements/${first}/approval`, "POST", {...manager.reviewApprovalContext, expectedNodeIndex: 1, decision: "approve"}, 201)
  ]);
  const approved = await read(first);
  assert.equal(approved.procurement.status, "approved_in_progress");
  assert.deepEqual(approved.payments, []); assert.equal(approved.receipt.available, false); assert.equal(approved.receipt.currentRevisionNo, null);
  assert.deepEqual({pending: approved.purchaseTask.pending, canHandle: approved.purchaseTask.canHandle, requiresReceipt: approved.purchaseTask.requiresReceipt}, {pending: true, canHandle: true, requiresReceipt: false});
  const returnedId = await create(); const draft = await read(returnedId);
  const old = {expectedVersionId: draft.currentVersion.id, expectedDraftRevision: draft.currentVersion.draftRevision};
  await call("applicant", `/spot-procurements/${returnedId}/submission`, "POST", old, 201);
  const pending = await read(returnedId, "manager");
  await call("manager", `/spot-procurements/${returnedId}/approval`, "POST", {...pending.reviewApprovalContext, expectedNodeIndex: 1, decision: "reject", comment: "需求请补充"}, 201);
  const returned = await read(returnedId); assert.equal(returned.procurement.status, "draft"); assert.notEqual(returned.currentVersion.id, draft.currentVersion.id);
  await call("applicant", `/spot-procurements/${returnedId}/draft`, "PATCH", {...values, ...old}, 409);
  await call("applicant", `/spot-procurements/${returnedId}/submission`, "POST", old, 409);
}
