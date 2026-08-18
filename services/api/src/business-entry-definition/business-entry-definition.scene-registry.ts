import {
  createBusinessEntryDefinitionRegistry,
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  PROJECT_OPERATING_TAKEOVER_STATUS_LABELS,
  PROJECT_OPERATING_TAKEOVER_STATUSES,
  type BusinessEntrySceneDefinition,
  type BusinessEntryOperation,
  type RoleKey
} from "@jiangkong/shared-domain";
import {
  createBusinessEntrySceneAccessRegistry,
  type BusinessEntrySceneAccessPolicy
} from "./business-entry-scene-access";

const projectFinanceRoles = ["finance_staff", "finance_director"] as const;
const organizationRoles = [
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director",
  "super_admin"
] as const;
const companyRoles = ["comprehensive_director", "contract_staff", "contract_director"] as const;
const contractTemplateRoles = ["contract_staff", "contract_director"] as const;
const settlementTemplateRoles = ["contract_director", "super_admin"] as const;
const authenticatedSelf = ["authenticated_self"] as unknown as readonly RoleKey[];

function textField(
  key: string,
  label: string,
  roles: readonly RoleKey[],
  options: Partial<BusinessEntrySceneDefinition["fields"][number]> = {}
) {
  return {
    key,
    label,
    description: `${label}的统一录入元数据。`,
    example: "示例",
    type: "text" as const,
    scope: "header" as const,
    unit: "",
    precision: 0,
    required: false,
    permissions: { view: roles, edit: roles, import: roles },
    display: {
      formHint: `请填写${label}`,
      gridColumn: label,
      mobilePriority: 1,
      readonlyText: `以冻结快照中的${label}为准`
    },
    excel: { column: label, paste: "single" as const, errorLocation: "cell" as const },
    bulk: { enabled: true, maxRows: 100, strategy: "append" as const },
    ...options
  };
}

function globalDefinition(
  key: string,
  entityType: string,
  name: string,
  fields: readonly BusinessEntrySceneDefinition["fields"][number][]
): BusinessEntrySceneDefinition {
  return {
    key,
    entityType,
    name,
    description: `${name}的统一录入场景。`,
    version: 1,
    fields,
    rules: []
  };
}

function existingTargetId(target: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]["target"]) {
  return "entityId" in target && typeof target.entityId === "string" ? target.entityId : undefined;
}

const globalTarget = (
  entityType: string,
  resolve: NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>
) => ({ scope: "global" as const, entityType, resolve });

function editableStatus(operation: BusinessEntryOperation) {
  return operation === "view" || operation === "export" ? undefined : "draft";
}

const resolveUser = async ({ target, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  const user = await prisma.user.findUnique({ where: { id, isActive: true }, select: { id: true } });
  return Boolean(user);
};

const resolveSelf = async ({ target, actorUserId, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id || id !== actorUserId) return false;
  const user = await prisma.user.findUnique({ where: { id, isActive: true }, select: { id: true } });
  return Boolean(user);
};

const resolveDepartment = async ({ target, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  return Boolean(await prisma.department.findUnique({ where: { id, isActive: true }, select: { id: true } }));
};

const resolveCompany = async ({ target, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  return Boolean(await prisma.companyEntity.findUnique({ where: { id, isActive: true }, select: { id: true } }));
};

const resolveParty = async ({ target, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  return Boolean(await prisma.businessParty.findUnique({ where: { id, status: "active" }, select: { id: true } }));
};

const resolveContractBusinessTemplate = async ({ target, operation, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  const status = editableStatus(operation);
  return Boolean(await prisma.contractBusinessTemplate.findUnique({
    where: { id, ...(status ? { status } : {}) },
    select: { id: true }
  }));
};

const resolveLayoutVersion = async ({ target, operation, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  const status = editableStatus(operation);
  return Boolean(await prisma.contractLayoutTemplateVersion.findUnique({
    where: { id, ...(status ? { status } : {}) },
    select: { id: true }
  }));
};

const resolveClauseVersion = async ({ target, operation, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  const status = editableStatus(operation);
  return Boolean(await prisma.standardClauseVersion.findUnique({
    where: { id, ...(status ? { status } : {}) },
    select: { id: true }
  }));
};

const resolveSettlementVersion = async ({ target, operation, prisma }: Parameters<NonNullable<BusinessEntrySceneAccessPolicy["target"]["resolve"]>>[0]) => {
  const id = existingTargetId(target);
  if (!id) return false;
  const status = editableStatus(operation);
  return Boolean(await prisma.settlementTemplateVersion.findUnique({
    where: { id, ...(status ? { status } : {}) },
    select: { id: true }
  }));
};

export const BUSINESS_ENTRY_SCENE_DEFINITIONS: readonly BusinessEntrySceneDefinition[] = [
  {
    key: "project_operating_profile",
    entityType: "project",
    name: "项目经营档案",
    description: "维护项目经营账生效日、历史接管完成日和受控接管状态。",
    version: 1,
    fields: [
      {
        key: "operatingLedgerEffectiveDate",
        label: "经营账生效日",
        description: "项目经营账开始纳入正式事实的日期。",
        example: "2026-08-16",
        type: "date",
        scope: "header",
        unit: "日",
        precision: 0,
        required: false,
        permissions: { view: projectFinanceRoles, edit: projectFinanceRoles },
        display: {
          formHint: "填写项目经营账开始纳入正式事实的日期",
          gridColumn: "经营账生效日",
          mobilePriority: 1,
          readonlyText: "以项目经营账生效日为准"
        },
        excel: { column: "经营账生效日", paste: "single", errorLocation: "cell" },
        bulk: { enabled: true, maxRows: 1, strategy: "replace" }
      },
      {
        key: "takeoverCompletedDate",
        label: "经营接管完成日",
        description: "历史经营资料完成专业确认的日期。",
        example: "2026-08-16",
        type: "date",
        scope: "header",
        unit: "日",
        precision: 0,
        required: false,
        permissions: { view: projectFinanceRoles, edit: projectFinanceRoles },
        display: {
          formHint: "填写历史经营资料完成专业确认的日期",
          gridColumn: "经营接管完成日",
          mobilePriority: 2,
          readonlyText: "以经营接管完成日冻结快照为准"
        },
        excel: { column: "经营接管完成日", paste: "single", errorLocation: "cell" },
        bulk: { enabled: true, maxRows: 1, strategy: "replace" }
      },
      {
        key: "takeoverStatus",
        label: "经营接管状态",
        description: "项目历史经营资料的受控接管状态。",
        example: "正式使用、历史接管中",
        type: "single_select",
        scope: "header",
        unit: "",
        precision: 0,
        required: true,
        options: PROJECT_OPERATING_TAKEOVER_STATUSES.map((value) => ({
          value,
          label: PROJECT_OPERATING_TAKEOVER_STATUS_LABELS[value]
        })),
        permissions: { view: projectFinanceRoles, edit: projectFinanceRoles },
        display: {
          formHint: "只能选择系统登记的经营接管状态",
          gridColumn: "经营接管状态",
          mobilePriority: 1,
          readonlyText: "提交后按冻结版本展示"
        },
        excel: { column: "经营接管状态", paste: "single", errorLocation: "cell" },
        bulk: { enabled: true, maxRows: 1, strategy: "replace" }
      }
    ],
    rules: [
      {
        key: "takeover_completed_requires_date",
        kind: "required_if",
        when: {
          fieldKey: "takeoverStatus",
          operator: "eq",
          value: "takeover_completed"
        },
        fieldKey: "takeoverCompletedDate",
        message: "接管完成时必须填写经营接管完成日"
      },
      {
        key: "takeover_completed_date_after_effective_date",
        kind: "less_than_or_equal",
        leftFieldKey: "operatingLedgerEffectiveDate",
        rightFieldKey: "takeoverCompletedDate",
        message: "经营接管完成日不能早于经营账生效日"
      }
    ]
  },
  ...OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  globalDefinition("department", "department", "部门", [
    textField("name", "部门名称", organizationRoles),
    textField("parentId", "上级部门", organizationRoles)
  ]),
  globalDefinition("organization_user", "organization_user", "组织用户", [
    textField("name", "姓名", organizationRoles),
    textField("phone", "手机号", organizationRoles),
    textField("departmentId", "所属部门", organizationRoles)
  ]),
  globalDefinition("user_role_assignment_command", "user_role_assignment_command", "用户岗位命令", [
    textField("operation", "操作", organizationRoles),
    textField("roleKey", "岗位", organizationRoles),
    textField("scope", "授权范围", organizationRoles),
    textField("projectId", "项目", organizationRoles)
  ]),
  globalDefinition("company_entity", "company_entity", "我方公司主体", [
    textField("name", "公司名称", companyRoles),
    textField("unifiedSocialCreditCode", "统一社会信用代码", companyRoles),
    textField("registeredAddress", "注册地址", companyRoles)
  ]),
  globalDefinition("business_party", "business_party", "合作单位", [
    textField("name", "单位名称", contractTemplateRoles),
    textField("unifiedSocialCreditCode", "统一社会信用代码", contractTemplateRoles)
  ]),
  globalDefinition("contract_business_template", "contract_business_template", "合同业务模板", [
    textField("code", "模板编码", contractTemplateRoles),
    textField("businessCode", "业务编码", contractTemplateRoles),
    textField("name", "模板名称", contractTemplateRoles),
    textField("contractTypeKey", "合同类型", contractTemplateRoles),
    textField("changeSummary", "变更摘要", contractTemplateRoles)
  ]),
  globalDefinition("contract_layout_template_version", "contract_layout_template_version", "合同版式模板版本", [
    textField("name", "版式名称", contractTemplateRoles),
    textField("contractTypeKey", "合同类型", contractTemplateRoles)
  ]),
  globalDefinition("standard_clause_version", "standard_clause_version", "标准条款版本", [
    textField("code", "条款编码", contractTemplateRoles),
    textField("category", "条款分类", contractTemplateRoles),
    textField("name", "条款名称", contractTemplateRoles),
    textField("title", "条款标题", contractTemplateRoles)
  ]),
  globalDefinition("settlement_template_version", "settlement_template_version", "结算模板版本", [
    textField("name", "模板名称", settlementTemplateRoles),
    textField("code", "模板编码", settlementTemplateRoles)
  ]),
  {
    ...globalDefinition("user_self_profile", "user_self_profile", "本人资料", [
      textField("name", "姓名", authenticatedSelf),
      textField("phone", "手机号", authenticatedSelf)
    ]),
    description: "仅允许已认证本人维护姓名和手机号；当前密码由最终提交控件专用校验。"
  }
];

export const BUSINESS_ENTRY_DEFINITION_REGISTRY = createBusinessEntryDefinitionRegistry(
  BUSINESS_ENTRY_SCENE_DEFINITIONS
);

export const BUSINESS_ENTRY_SCENE_ACCESS_POLICIES: readonly BusinessEntrySceneAccessPolicy[] =
  Object.freeze([
    {
      sceneKey: "project_operating_profile",
      target: { scope: "project", entityType: "project" },
      permission: {
        kind: "business_action",
        action: "project.operating_profile.manage",
        roleScope: "project"
      }
    },
    ...OPERATING_TAKEOVER_SCENE_DEFINITIONS.map((definition) => ({
      sceneKey: definition.key,
      target: { scope: "project" as const, entityType: definition.entityType },
      permission: {
        kind: "business_action" as const,
        action: "operating_takeover.manage" as const,
        roleScope: "effective" as const
      }
    })),
    {
      sceneKey: "department",
      target: globalTarget("department", resolveDepartment),
      permission: { kind: "role_keys", roleKeys: organizationRoles, roleScope: "global" }
    },
    {
      sceneKey: "organization_user",
      target: globalTarget("organization_user", resolveUser),
      permission: { kind: "role_keys", roleKeys: organizationRoles, roleScope: "global" }
    },
    {
      sceneKey: "user_role_assignment_command",
      target: globalTarget("user_role_assignment_command", resolveUser),
      permission: { kind: "role_keys", roleKeys: organizationRoles, roleScope: "global" }
    },
    {
      sceneKey: "company_entity",
      target: globalTarget("company_entity", resolveCompany),
      permission: { kind: "role_keys", roleKeys: companyRoles, roleScope: "global" }
    },
    {
      sceneKey: "business_party",
      target: globalTarget("business_party", resolveParty),
      permission: { kind: "role_keys", roleKeys: contractTemplateRoles, roleScope: "global" }
    },
    {
      sceneKey: "contract_business_template",
      target: globalTarget("contract_business_template", resolveContractBusinessTemplate),
      permission: { kind: "role_keys", roleKeys: contractTemplateRoles, roleScope: "global" }
    },
    {
      sceneKey: "contract_layout_template_version",
      target: globalTarget("contract_layout_template_version", resolveLayoutVersion),
      permission: { kind: "role_keys", roleKeys: contractTemplateRoles, roleScope: "global" }
    },
    {
      sceneKey: "standard_clause_version",
      target: globalTarget("standard_clause_version", resolveClauseVersion),
      permission: { kind: "role_keys", roleKeys: contractTemplateRoles, roleScope: "global" }
    },
    {
      sceneKey: "settlement_template_version",
      target: globalTarget("settlement_template_version", resolveSettlementVersion),
      permission: { kind: "role_keys", roleKeys: settlementTemplateRoles, roleScope: "global" }
    },
    {
      sceneKey: "user_self_profile",
      target: globalTarget("user_self_profile", resolveSelf),
      permission: { kind: "authenticated_self", roleScope: "global" }
    }
  ]);

export const BUSINESS_ENTRY_ACCESS_REGISTRY = createBusinessEntrySceneAccessRegistry(
  BUSINESS_ENTRY_SCENE_DEFINITIONS,
  BUSINESS_ENTRY_SCENE_ACCESS_POLICIES
);
