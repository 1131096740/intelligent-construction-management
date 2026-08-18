import { BusinessEntrySceneAuthorizationService } from "./business-entry-scene-authorization.service";

describe("BusinessEntrySceneAuthorizationService", () => {
  function createService() {
    const organization = { assertCanMaintainBusinessEntryOrganization: jest.fn() };
    const organizationRoles = { assertCanMaintainBusinessEntryRole: jest.fn() };
    const companyEntities = { assertCanMaintain: jest.fn() };
    const businessParties = { assertCanMaintainBusinessEntry: jest.fn() };
    const contractTemplates = { assertCanMaintainBusinessEntry: jest.fn() };
    const layouts = { assertCanMaintainBusinessEntry: jest.fn() };
    const settlementTemplates = { assertCanMaintainBusinessEntry: jest.fn() };
    return {
      service: new BusinessEntrySceneAuthorizationService(
        organization as never,
        organizationRoles as never,
        companyEntities as never,
        businessParties as never,
        contractTemplates as never,
        layouts as never,
        settlementTemplates as never
      ),
      organization,
      organizationRoles,
      companyEntities,
      businessParties,
      contractTemplates,
      layouts,
      settlementTemplates
    };
  }

  it("delegates validate/freeze authorization to the owning domain service", async () => {
    const { service, businessParties, contractTemplates, settlementTemplates } = createService();
    await service.assertAuthorized({
      sceneKey: "business_party",
      actorUserId: "actor-1",
      operation: "edit",
      scope: "global",
      target: { entityType: "business_party", entityId: "party-1" },
      values: { name: "合作单位" }
    });
    await service.assertAuthorized({
      sceneKey: "contract_business_template",
      actorUserId: "actor-1",
      operation: "edit",
      scope: "global",
      target: { entityType: "contract_business_template", createTarget: "signed-target" },
      values: { code: "HT" }
    });
    await service.assertAuthorized({
      sceneKey: "settlement_template_version",
      actorUserId: "actor-1",
      operation: "import",
      scope: "global",
      target: { entityType: "settlement_template_version", entityId: "version-1" },
      values: { name: "结算模板" }
    });

    expect(businessParties.assertCanMaintainBusinessEntry).toHaveBeenCalledWith("actor-1");
    expect(contractTemplates.assertCanMaintainBusinessEntry).toHaveBeenCalledWith("actor-1");
    expect(settlementTemplates.assertCanMaintainBusinessEntry).toHaveBeenCalledWith("actor-1");
  });

  it("does not let a self-profile command cross the authenticated actor boundary", async () => {
    const { service } = createService();

    await expect(service.assertAuthorized({
      sceneKey: "user_self_profile",
      actorUserId: "actor-1",
      operation: "edit",
      scope: "global",
      target: { entityType: "user_self_profile", entityId: "actor-2" },
      values: { name: "越权" }
    })).rejects.toThrow("本人资料只能由已认证本人提交");
  });
});
