import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { buildTask12GeneratedApprovalFixture, openTask12GeneratedApprovalDraft, type Task12GeneratedAdmissionRequest } from "../database/task12-generated-approval-admission";
import { createTemplateTestServer } from "./template-management.test-support";

describe("表内生成审批真实数据库入口的公开前置协议", () => {
  it("仅用隔离项目主数据办理草稿和编辑权，并拒绝无项目岗位的同库账号", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const fixture = buildTask12GeneratedApprovalFixture(randomUUID());
      const prisma = server.store.prisma;
      await prisma.project.create({ data: fixture.project });
      const passwordHash = await bcrypt.hash(server.password, 4);
      for (const user of fixture.users) {
        await prisma.user.create({ data: { ...user, passwordHash } });
      }
      for (const member of fixture.members) {
        await prisma.projectMember.create({ data: member });
      }
      for (const assignment of fixture.globalRoles) {
        const position = await prisma.position.findUnique({ where: { key: assignment.roleKey } })
          ?? await prisma.position.create({ data: { key: assignment.roleKey, name: assignment.roleKey } });
        await prisma.userPosition.create({ data: { id: assignment.id, userId: assignment.userId, projectId: null, positionId: position.id } });
      }

      const root = await server.app.getUrl();
      const log: Array<[string, string]> = [];
      const send = async (request: Task12GeneratedAdmissionRequest) => {
        log.push([request.method, request.path]);
        const response = await fetch(root + request.path, {
          method: request.method, headers: request.headers,
          ...(request.json ? { body: JSON.stringify(request.json) } : {})
        });
        return { status: response.status, body: await response.json() as unknown };
      };
      await expect(openTask12GeneratedApprovalDraft(fixture, server.password, request => send(
        request.path === "/auth/login"
          ? { ...request, json: { ...request.json, phone: fixture.outsiderPhone } }
          : request
      ))).rejects.toMatchObject({ code: "TASK12_GENERATED_ADMISSION_CAPABILITY" });
      expect(log.map(([, path]) => path.split("?")[0])).toEqual(["/auth/login", "/contracts/create-capability"]);
      expect(await prisma.contract.count({ where: { projectId: fixture.project.id } })).toBe(0);

      log.length = 0;
      const receipt = await openTask12GeneratedApprovalDraft(fixture, server.password, send);
      expect(receipt).toEqual({
        status: "DRAFT_ADMISSION_PROTOCOL_MATCHED", projectId: fixture.project.id,
        contractId: expect.any(String), versionId: expect.any(String), leaseRevision: 1
      });
      expect(log).toEqual([
        ["POST", "/auth/login"],
        ["GET", "/contracts/create-capability?projectId=" + fixture.project.id + "&relationship=inside"],
        ["POST", "/contracts"],
        ["POST", "/contract-drafts/" + receipt.versionId + "/edit-lease"],
        ["GET", "/contract-drafts/" + receipt.versionId + "/workbench"]
      ]);
      expect(await prisma.contract.count({ where: { projectId: fixture.project.id } })).toBe(1);
      expect(await prisma.approvalInstance.count({ where: { businessId: receipt.versionId } })).toBe(0);
      expect(await prisma.contractGeneratedDocument.count({ where: { contractVersionId: receipt.versionId } })).toBe(0);

      log.length = 0;
      await expect(openTask12GeneratedApprovalDraft(fixture, server.password, async request => {
        const response = await send(request);
        if (request.path !== "/contracts") return response;
        const body = response.body as { contract: Record<string, unknown> };
        return { ...response, body: { ...body, contract: { ...body.contract, ownerUserId: randomUUID() } } };
      })).rejects.toMatchObject({ code: "TASK12_GENERATED_ADMISSION_CREATE" });
      expect(log.map(([, path]) => path.split("?")[0])).toEqual(["/auth/login", "/contracts/create-capability", "/contracts"]);
      expect(await prisma.contractDraftEditLease.count()).toBe(1);

    } finally {
      await server.app.close();
    }
  });
});
