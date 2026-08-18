import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import {
  isBusinessEntryExistingTarget,
  type BusinessEntryOperation,
  type BusinessEntrySubmissionTarget
} from "@jiangkong/shared-domain";
import { BusinessPartyService } from "../business-party/business-party.service";
import { CompanyEntityAccess } from "../company-entity/company-entity-access";
import { ContractTemplateService } from "../contract-template/contract-template.service";
import { LayoutTemplateService } from "../contract-template/layout-template.service";
import { OrganizationRoleService } from "../organization/organization-role.service";
import { OrganizationService } from "../organization/organization.service";
import { SettlementTemplateService } from "../settlement/settlement-template.service";
import type { BusinessEntryTargetScope } from "./business-entry-scene-access";

export interface BusinessEntrySceneAuthorizationContext {
  sceneKey: string;
  actorUserId: string;
  projectId?: string;
  operation: BusinessEntryOperation;
  scope: BusinessEntryTargetScope;
  target: BusinessEntrySubmissionTarget;
  values: Record<string, unknown>;
}

@Injectable()
export class BusinessEntrySceneAuthorizationService {
  constructor(
    private readonly organization: OrganizationService,
    private readonly organizationRoles: OrganizationRoleService,
    private readonly companyEntities: CompanyEntityAccess,
    private readonly businessParties: BusinessPartyService,
    private readonly contractTemplates: ContractTemplateService,
    private readonly layouts: LayoutTemplateService,
    private readonly settlementTemplates: SettlementTemplateService
  ) {}

  async assertAuthorized(context: BusinessEntrySceneAuthorizationContext) {
    const targetId = isBusinessEntryExistingTarget(context.target)
      ? context.target.entityId
      : undefined;
    switch (context.sceneKey) {
      case "department":
      case "organization_user":
        await this.organization.assertCanMaintainBusinessEntryOrganization(
          context.actorUserId,
          context.sceneKey,
          targetId,
          context.values
        );
        return;
      case "user_role_assignment_command":
        if (!targetId) {
          throw new BadRequestException("岗位命令必须绑定已存在的目标用户");
        }
        await this.organizationRoles.assertCanMaintainBusinessEntryRole(
          context.actorUserId,
          targetId,
          context.values
        );
        return;
      case "company_entity":
        await this.companyEntities.assertCanMaintain(context.actorUserId);
        return;
      case "business_party":
        await this.businessParties.assertCanMaintainBusinessEntry(context.actorUserId);
        return;
      case "contract_business_template":
      case "standard_clause_version":
        await this.contractTemplates.assertCanMaintainBusinessEntry(context.actorUserId);
        return;
      case "contract_layout_template_version":
        await this.layouts.assertCanMaintainBusinessEntry(context.actorUserId);
        return;
      case "settlement_template_version":
        await this.settlementTemplates.assertCanMaintainBusinessEntry(context.actorUserId);
        return;
      case "user_self_profile":
        if (!targetId || targetId !== context.actorUserId) {
          throw new ForbiddenException("本人资料只能由已认证本人提交");
        }
        return;
      default:
        throw new BadRequestException("业务场景未登记领域授权器");
    }
  }
}
