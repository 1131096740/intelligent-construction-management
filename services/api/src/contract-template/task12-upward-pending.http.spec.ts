import { randomUUID } from "node:crypto";
import { seedDirectPendingDatabaseBinding } from "./task12-direct-pending.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

describe("任务12 对上直签待登记", () => {
  it("无对上来源资格时已授权经办也不能创建，未授权账号不获知资格状态", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const projectId = randomUUID();
      await server.store.prisma.project.create({
        data: { id: projectId, code: "T12-UPWARD-SOURCE", name: "对上来源合成项目", isActive: true }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId, userId: "staff", positionKey: "contract_staff" }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId, userId: "employee", positionKey: "employee" }
      });
      const otherProjectId = randomUUID();
      await server.store.prisma.project.create({
        data: { id: otherProjectId, code: "T12-UPWARD-OTHER", name: "另一个合成项目", isActive: true }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId: otherProjectId, userId: "employee", positionKey: "contract_staff" }
      });
      const url = (await server.app.getUrl()) + "/contracts";
      const create = async (actor: "staff" | "employee") => fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer " + await loginTemplateActor(server, actor),
          "content-type": "application/json"
        },
        body: JSON.stringify({
          projectId,
          numericProtocolVersion: 2,
          contractTypeKey: "material_purchase",
          relationship: "upward",
          handlingMode: "direct_signed"
        })
      });

      const unauthorized = await create("employee");
      expect(unauthorized.status).toBe(403);
      expect(await unauthorized.text()).not.toContain("对上已签合同来源暂时无法核对");
      const unavailable = await create("staff");
      expect({ status: unavailable.status, body: await unavailable.json() }).toMatchObject({
        status: 503,
        body: { message: "对上已签合同来源暂时无法核对，请保留资料稍后办理" }
      });
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);
      expect(await server.store.prisma.contractVersion.count()).toBe(0);
      expect(await server.store.prisma.auditLog.count({ where: { action: "contract.draft.create" } })).toBe(0);
    } finally {
      await server.app.close();
    }
  });

  it("已核对的表外资格只供原表外草稿，对上生成草稿仍可单独创建", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      await seedDirectPendingDatabaseBinding(server);
      const projectId = randomUUID();
      await server.store.prisma.project.create({
        data: { id: projectId, code: "T12-UPWARD-ISOLATION", name: "对上与表外资格隔离合成项目", isActive: true }
      });
      await server.store.prisma.projectMember.create({
        data: { projectId, userId: "staff", positionKey: "contract_staff" }
      });
      const headers = {
        authorization: "Bearer " + await loginTemplateActor(server, "staff"),
        "content-type": "application/json",
        "x-contract-numeric-protocol": "2"
      };
      const base = await server.app.getUrl();
      const create = (relationship: "upward" | "outside", handlingMode: "direct_signed" | "generated_approval") =>
        fetch(base + "/contracts", {
          method: "POST",
          headers,
          body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship, handlingMode })
        });

      expect((await create("upward", "direct_signed")).status).toBe(503);
      expect(await server.store.prisma.contract.count({ where: { projectId } })).toBe(0);

      const outside = await create("outside", "direct_signed");
      expect({ status: outside.status, body: await outside.json() }).toMatchObject({
        status: 201,
        body: { version: { draftData: { directSigningInput: { protocolVersion: 1, relationship: "outside" } } } }
      });

      const generated = await create("upward", "generated_approval");
      expect(generated.status).toBe(201);
      const draft = await generated.json();
      expect(draft.version.draftData).toMatchObject({ contractBasics: { relationship: "upward" } });
      expect(draft.version.draftData).not.toHaveProperty("directSigningInput");
      expect(await server.store.prisma.contractVersion.count()).toBe(2);
      expect(await server.store.prisma.approvalInstance.count()).toBe(0);
      expect(await server.store.prisma.contractArchiveFile.count()).toBe(0);
      expect(await server.store.prisma.operatingFact.count()).toBe(0);
    } finally {
      await server.app.close();
    }
  });

});
