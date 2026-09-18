import type { Prisma } from "@prisma/client";
import { BUSINESS_ENTRY_SCENE_DEFINITIONS } from "./business-entry-definition.scene-registry";
import {
  BusinessEntryDomainAuthorizationRegistry,
  BusinessEntrySceneAuthorizationService
} from "./business-entry-scene-authorization.service";

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
        settlementTemplates as never,
        {
          assertCanMaintainBusinessEntry: jest.fn(),
          assertCanDeactivateBusinessEntry: jest.fn()
        } as never,
        { assertCanRenameBusinessEntry: jest.fn() } as never,
        {} as never
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

  it("passes an existing caller transaction to a transaction-aware domain resolver", async () => {
    const { service, companyEntities } = createService();
    const tx = { marker: "caller-tx" } as unknown as Prisma.TransactionClient;

    await service.assertAuthorized({
      sceneKey: "company_entity",
      actorUserId: "actor-1",
      operation: "edit",
      scope: "global",
      target: { entityType: "company_entity", entityId: "company-1" },
      values: { name: "我方公司" },
      tx
    });

    expect(companyEntities.assertCanMaintain).toHaveBeenCalledWith("actor-1", tx);
  });

  it("validates the production authorization registry as a closed one-to-one set", () => {
    const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!;
    const resolver = jest.fn();

    expect(() => new BusinessEntryDomainAuthorizationRegistry(
      [definition],
      []
    )).toThrow(`业务场景缺少领域授权解析器：${definition.key}`);
    expect(() => new BusinessEntryDomainAuthorizationRegistry(
      [definition],
      [
        { sceneKey: definition.key, resolve: resolver },
        { sceneKey: definition.key, resolve: resolver }
      ]
    )).toThrow(`领域授权解析器重复注册：${definition.key}`);
    expect(() => new BusinessEntryDomainAuthorizationRegistry(
      [],
      [{ sceneKey: definition.key, resolve: resolver }]
    )).toThrow(`领域授权解析器引用未注册场景：${definition.key}`);
  });
});
