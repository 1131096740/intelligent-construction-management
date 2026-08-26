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

  it("binds a business-party target to its server-owned purpose", () => {
    const service = new BusinessEntryCreateTargetService();
    const probe = service.issue({
      actorUserId: "actor-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      action: "business_party.create",
      definitionKey: "business_party",
      definitionVersion: 1,
      purpose: "definition_probe"
    });
    const expected = {
      actorUserId: "actor-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global" as const,
      action: "business_party.create",
      definitionKey: "business_party",
      definitionVersion: 1
    };

    expect(service.verify(probe.createTarget, {
      ...expected,
      purpose: "definition_probe"
    })).toMatchObject({ purpose: "definition_probe" });
    expect(() => service.verify(probe.createTarget, {
      ...expected,
      purpose: "submission"
    })).toThrow("新建目标令牌无效");
  });

  it("keeps probe and submission targets mutually exclusive", () => {
    const service = new BusinessEntryCreateTargetService();
    const claims = {
      actorUserId: "actor-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global" as const,
      action: "business_party.create",
      definitionKey: "business_party",
      definitionVersion: 1
    };
    const probe = service.issue({ ...claims, purpose: "definition_probe" });
    const submission = service.issue({ ...claims, purpose: "submission" });

    expect(submission.createTarget).not.toBe(probe.createTarget);
    expect(() => service.verify(probe.createTarget, { ...claims, purpose: "submission" }))
      .toThrow("新建目标令牌无效");
    expect(() => service.verify(submission.createTarget, { ...claims, purpose: "definition_probe" }))
      .toThrow("新建目标令牌无效");
  });
});
