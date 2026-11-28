import { createGeneralRequestHarness } from "../general-procurement/general-procurement-request.test-support";

describe("生产材料采购待办公开HTTP", () => {
  let harness: Awaited<ReturnType<typeof createGeneralRequestHarness>>;
  beforeEach(async () => { harness = await createGeneralRequestHarness(); });
  afterEach(async () => { await harness.app.close(); });
  function seed(projectId: string = harness.projectId, suffix = "01") {
    const id = `spot-${suffix}`, versionId = `version-${suffix}`;
    const updatedAt = new Date("2026-11-06T00:00:00Z");
    (harness.tables.spotProcurement ??= []).push({id, projectId, code: `LX-${suffix}`, applicantUserId: harness.managerId, currentVersionId: versionId, status: "approved_in_progress", updatedAt});
    (harness.tables.spotProcurementVersion ??= []).push({id: versionId, procurementId: id, status: "approved", requestProtocolVersion: 2, estimatedTotalAmount: null, reason: "审批后采购材料", versionNo: 1});
    return {id, versionId};
  }
  function staff() {
    harness.tables.projectMember = [{userId: harness.userId, projectId: harness.projectId, positionKey: "material_staff"}];
  }
  it("另一名当前项目物资员收到本人采购待办和数量，撤权、改版或办结即消失", async () => {
    staff(); const row = seed();
    harness.tables.project.push({id: "other-project", name: "其他项目", isActive: true}); seed("other-project", "other");
    const read = () => harness.request("/me/work-items");
    const current = await read();
    expect(current.status).toBe(200);
    expect(current.body.queueMeta.pending.total).toBe(1);
    expect(current.body.queues.pending).toEqual([expect.objectContaining({type: "procurement", businessType: "spot_procurement", businessId: row.id, targetPath: `/零星采购/${row.id}`, amountText: "预计金额待确定"})]);
    harness.tables.projectMember = [];
    expect((await read()).body.queueMeta.pending.total).toBe(0);
    staff(); harness.tables.spotProcurement[0].currentVersionId = "new-draft";
    harness.tables.spotProcurementVersion.push({id: "new-draft", procurementId: row.id, status: "draft", requestProtocolVersion: 2});
    expect((await read()).body.queueMeta.pending.total).toBe(0);
    harness.tables.spotProcurement[0].currentVersionId = row.versionId;
    harness.tables.spotProcurement[0].status = "closed";
    expect((await read()).body.queueMeta.pending.total).toBe(0);
  });
  it("公司物资主管跨项目办理，旧项目主管岗位不能冒充公司权限", async () => {
    seed(); harness.tables.project.push({id: "other-project", name: "其他项目", isActive: true}); seed("other-project", "other");
    harness.tables.position.push({id: "material-director", key: "material_director"});
    harness.tables.userPosition.push({userId: harness.directorId, projectId: null, positionId: "material-director"});
    const current = await harness.request("/me/work-items", undefined, harness.directorId);
    expect(current.status).toBe(200); expect(current.body.queueMeta.pending.total).toBe(2);
    harness.tables.userPosition = harness.tables.userPosition.filter(row => row.positionId !== "material-director");
    harness.tables.projectMember = [{userId: harness.directorId, projectId: harness.projectId, positionKey: "material_director"}];
    expect((await harness.request("/me/work-items", undefined, harness.directorId)).body.queueMeta.pending.total).toBe(0);
  });
  it("本人102项待采购全部计数，列表只返回30且不把截断数当总数", async () => {
    staff(); for (let i = 0; i < 102; i++) seed(harness.projectId, String(i).padStart(3, "0"));
    const current = await harness.request("/me/work-items");
    expect(current.status).toBe(200);
    expect(current.body.queueMeta.pending).toEqual({total: 102, returned: 30, truncated: true});
    expect(current.body.queues.pending).toHaveLength(30);
  });
});
