import { BusinessEntryCreateTargetService } from "./business-entry-create-target.service";

describe("BusinessEntryCreateTargetService", () => {
  it("issues a short-lived target bound to actor, scene, entity type and scope", () => {
    const service = new BusinessEntryCreateTargetService();
    const issued = service.issue({
      actorUserId: "actor-1",
      scene: "company_entity",
      entityType: "company_entity",
      scope: "global"
    });

    expect(issued.createTarget.split(".")).toHaveLength(2);
    expect(service.verify(issued.createTarget, {
      actorUserId: "actor-1",
      scene: "company_entity",
      entityType: "company_entity",
      scope: "global"
    })).toMatchObject({
      actorUserId: "actor-1",
      scene: "company_entity",
      entityType: "company_entity",
      scope: "global"
    });
  });

  it("fails closed when replayed across actor, scene or project scope", () => {
    const service = new BusinessEntryCreateTargetService();
    const issued = service.issue({
      actorUserId: "actor-1",
      scene: "company_entity",
      entityType: "company_entity",
      scope: "global"
    });

    expect(() => service.verify(issued.createTarget, {
      actorUserId: "actor-2",
      scene: "company_entity",
      entityType: "company_entity",
      scope: "global"
    })).toThrow("新建目标令牌无效");
    expect(() => service.verify(issued.createTarget, {
      actorUserId: "actor-1",
      scene: "business_party",
      entityType: "company_entity",
      scope: "global"
    })).toThrow("新建目标令牌无效");
    expect(() => service.verify(issued.createTarget, {
      actorUserId: "actor-1",
      scene: "company_entity",
      entityType: "company_entity",
      scope: "project",
      projectId: "project-1"
    })).toThrow("新建目标令牌无效");
  });
});
