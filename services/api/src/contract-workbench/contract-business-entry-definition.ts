import { contractFieldsForBusinessUse, isContractBillCustomColumn, type ContractBillDefinition, type ContractFieldDefinition, type BusinessEntryFieldDefinition, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { BadRequestException } from "@nestjs/common";
import type { ContractVersion, Prisma } from "@prisma/client";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";

const contractEditors = ["contract_staff", "contract_director"] as const;

function headerField(
  key: string,
  label: string,
  type: BusinessEntryFieldDefinition["type"],
  order: number
): BusinessEntryFieldDefinition {
  return {
    key, label, type, order,
    description: `请填写${label}，正式提交后保留本次填写内容。`,
    example: label === "合同名称" ? "材料采购合同" : label === "我方签约主体" ? "我方公司" : `按合同填写${label}`,
    scope: "header", unit: "", precision: 0, required: true,
    permissions: { view: contractEditors, edit: contractEditors },
    bulk: { enabled: false, strategy: "replace" },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    display: {
      formHint: `请填写${label}`, gridColumn: label,
      mobilePriority: order, readonlyText: `以提交时的${label}为准`
    }
  };
}

export const CONTRACT_BASIC_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "contract_basic", entityType: "contract_version",
  name: "合同基础信息", description: "合同名称与我方签约主体。", version: 1,
  fields: [
    headerField("contractName", "合同名称", "text", 1),
    headerField("companyEntityId", "我方签约主体", "company", 2)
  ],
  rules: []
};

const selectField = (key: string, label: string, order: number, options: Array<{ value: string; label: string }>) => ({
  ...headerField(key, label, "single_select", order), options
});

export const CONTRACT_COMMERCIAL_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "contract_commercial_terms", entityType: "contract_version", version: 1,
  name: "合同计价与税务", description: "合同提交时的计价、金额与税务事实。", rules: [],
  fields: [
    selectField("pricingNature", "计价性质", 1, [{ value: "fixed_total", label: "固定总价" }, { value: "provisional_total", label: "暂定总价" }, { value: "unit_price", label: "固定单价" }, { value: "framework", label: "框架合同" }]),
    selectField("amountSource", "金额来源", 2, [{ value: "bill_sum", label: "清单汇总" }, { value: "manual", label: "手工填写" }]),
    { ...headerField("contractAmountYuan", "合同金额", "money", 3), unit: "元", precision: 2 },
    { ...headerField("estimatedAmountYuan", "预计发生金额", "money", 4), required: false, unit: "元", precision: 2 },
    { ...headerField("amountAdjustmentReason", "金额调整原因", "long_text", 5), required: false },
    { ...selectField("invoiceType", "发票类型", 6, [{ value: "vat_general", label: "增值税普通发票" }, { value: "vat_special", label: "增值税专用发票" }]), required: false },
    selectField("taxMode", "税率模式", 7, [{ value: "single_rate", label: "单一税率" }, { value: "multiple_rate", label: "特殊多税率" }]),
    { ...headerField("defaultTaxRatePercent", "默认税率", "number", 8), required: false, unit: "%", precision: 6 },
    selectField("taxFactSource", "税务事实来源", 9, [{ value: "contract_document", label: "合同文件" }])
  ]
};

export function contractCommercialEntryValues(version: ContractVersion) {
  return Object.fromEntries(Object.entries({
    pricingNature: version.pricingNature, amountSource: version.amountSource,
    contractAmountYuan: formatMoneyCentsAsPlainYuan(BigInt(version.amountCents.toString())),
    estimatedAmountYuan: version.estimatedAmountCents == null ? null : formatMoneyCentsAsPlainYuan(BigInt(version.estimatedAmountCents.toString())),
    amountAdjustmentReason: version.amountAdjustmentReason,
    invoiceType: version.invoiceType, taxMode: version.taxMode,
    defaultTaxRatePercent: version.defaultTaxRatePercent == null ? null : Number(version.defaultTaxRatePercent.toString()),
    taxFactSource: version.taxFactSource
  }).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

export const CONTRACT_PARTY_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "contract_party", entityType: "contract_party_snapshot", version: 1,
  name: "合同主体", description: "合同提交时的主体快照。", rules: [],
  fields: [
    headerField("roleName", "主体位置", "text", 1),
    { ...headerField("displayOrder", "主体顺序", "number", 2), precision: 0 },
    headerField("name", "主体名称", "text", 3),
    { ...headerField("unifiedSocialCreditCode", "统一社会信用代码", "text", 4), required: false },
    { ...headerField("legalRepresentative", "法定代表人", "text", 5), required: false },
    { ...headerField("address", "地址", "text", 6), required: false },
    { ...headerField("contactName", "联系人", "text", 7), required: false },
    { ...headerField("contactPhone", "联系电话", "text", 8), required: false }
  ]
};

const CONTRACT_PARTY_ROLE_NAMES: Readonly<Record<string, string>> = {
  party_a: "甲方", party_b: "乙方", party_c: "丙方", guarantor: "担保单位",
  consortium_member: "联合体成员", other: "其他"
};

export function contractPartyRoleName(roleKey: string) {
  return CONTRACT_PARTY_ROLE_NAMES[roleKey] ?? "主体位置待确认";
}

export const CONTRACT_PAYMENT_TERMS_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "contract_payment_terms", entityType: "payment_terms_version", version: 1,
  name: "付款条款", description: "合同提交时的付款条款原文。", rules: [],
  fields: [{ ...headerField("originalText", "付款条款原文", "long_text", 1) }]
};

export const CONTRACT_PAYMENT_STAGE_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "contract_payment_stage", entityType: "payment_terms_stage", version: 1,
  name: "付款阶段", description: "合同提交时的付款阶段。", rules: [],
  fields: [
    headerField("name", "阶段名称", "text", 1),
    selectField("stageType", "阶段类型", 2, Object.entries({ advance: "预付款", progress: "进度款", final: "结算款", retention: "质保金", other: "其他" }).map(([value, label]) => ({ value, label }))),
    selectField("basis", "付款依据", 3, Object.entries({ contract_amount: "合同金额", current_settlement: "当期结算", cumulative_settlement: "累计结算", fixed_amount: "固定金额", manual_amount: "手工金额" }).map(([value, label]) => ({ value, label }))),
    { ...headerField("ratioBps", "付款比例", "number", 4), required: false, unit: "万分比", precision: 0 },
    { ...headerField("fixedAmountYuan", "固定金额", "money", 5), required: false, unit: "元", precision: 2 },
    selectField("triggerAnchor", "触发节点", 6, Object.entries({ contract_effective: "合同生效", settlement_effective: "结算生效", final_settlement_effective: "最终结算生效" }).map(([value, label]) => ({ value, label }))),
    headerField("triggerEvent", "触发说明", "text", 7),
    { ...headerField("dueDays", "付款期限", "number", 8), unit: "天", precision: 0 },
    selectField("advanceDeductionMode", "预付款扣回方式", 9, Object.entries({ none: "不扣回", per_settlement_ratio: "每期结算按比例扣回", after_cumulative_settlement_ratio: "累计结算达标后扣回" }).map(([value, label]) => ({ value, label }))),
    { ...headerField("advanceDeductionRatioBps", "预付款扣回比例", "number", 10), required: false, precision: 0 },
    { ...headerField("advanceDeductionStartRatioBps", "预付款起扣比例", "number", 11), required: false, precision: 0 },
    headerField("requiresInvoice", "要求发票", "boolean", 12),
    headerField("allowsEarlyPayment", "允许提前付款", "boolean", 13),
    headerField("allowsInstallments", "允许分次付款", "boolean", 14),
    { ...headerField("retentionBps", "质保金比例", "number", 15), required: false, precision: 0 },
    { ...headerField("originalText", "阶段原文", "long_text", 16) }
  ]
};

export function contractBasicEntryValues(draftData: unknown, inheritedContractName?: string | null) {
  const draft = draftData && typeof draftData === "object" && !Array.isArray(draftData)
    ? draftData as Record<string, unknown> : {};
  const selection = draft.companyEntitySelection;
  const company = selection && typeof selection === "object" && !Array.isArray(selection)
    ? selection as Record<string, unknown> : {};
  return {
    contractName: typeof draft.contractName === "string"
      ? draft.contractName
      : inheritedContractName ?? "",
    companyEntityId: typeof company.id === "string" ? company.id : ""
  };
}

export const CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "contract_settlement_mode", entityType: "contract_version", version: 1,
  name: "合同结算方式", description: "由合同部主管确认本合同的结算方式。", rules: [],
  fields: [{
    ...headerField("settlementMode", "结算方式", "single_select", 1),
    permissions: { view: contractEditors, edit: ["contract_director"] },
    options: [
      { value: "settlement_required", label: "需要结算" },
      { value: "direct_payment", label: "按合同直接付款" }
    ],
    display: {
      formHint: "由合同部主管确认后才能提交审批、开结算或按合同发起应付款。",
      gridColumn: "结算方式", mobilePriority: 1, readonlyText: "以本次确认的结算方式为准"
    }
  }]
};

export async function resolveContractTemplateEntry(
  tx: Prisma.TransactionClient,
  version: ContractVersion
) {
  if (!version.businessTemplateVersionId) return null;
  const [source, contract] = await Promise.all([
    tx.contractBusinessTemplateVersion.findUnique({ where: { id: version.businessTemplateVersionId } }),
    tx.contract.findUnique({ where: { id: version.contractId } })
  ]);
  const snapshot = version.templateSnapshot;
  if (!source || !contract || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.fieldSchema)) {
    throw new BadRequestException("合同模板快照异常，请刷新后重试");
  }
  const fields = contractFieldsForBusinessUse(contract.contractTypeKey ?? "", snapshot.fieldSchema as unknown as ContractFieldDefinition[]);
  const definition: BusinessEntrySceneDefinition = {
    key: "contract_template_fields", entityType: "contract_version",
    name: "合同模板字段", description: "以本合同选定模板版本为准。", version: source.versionNo,
    source: { kind: "contract_business_template_version", id: source.id, version: source.versionNo },
    fields: fields.map((field, index) => ({
      ...headerField(field.key, field.label, field.type, field.order ?? index + 1),
      example: field.options?.[0]?.label ?? `按合同填写${field.label}`,
      required: field.required ?? false,
      defaultValue: field.defaultValue,
      options: field.options,
      group: field.group,
      visibleWhen: field.visibleWhen
    })),
    rules: []
  };
  const draft = version.draftData && typeof version.draftData === "object" && !Array.isArray(version.draftData) ? version.draftData : {};
  const fieldValues = draft.fieldValues && typeof draft.fieldValues === "object" && !Array.isArray(draft.fieldValues) ? draft.fieldValues : {};
  const values = Object.fromEntries(fields.map((field) => [field.key, Object.hasOwn(fieldValues, field.key) ? fieldValues[field.key] : draft[field.key]]).filter(([, value]) => value !== undefined));
  return { definition, values };
}

export async function resolveContractBillEntries(tx: Prisma.TransactionClient, version: ContractVersion) {
  const template = await resolveContractTemplateEntry(tx, version);
  if (!template) return [];
  const bills = await tx.contractBill.findMany({ where: { contractVersionId: version.id }, orderBy: { billKey: "asc" } });
  return bills.map((bill) => {
    const schema = bill.schemaSnapshot as unknown as ContractBillDefinition;
    if (!schema || !Array.isArray(schema.columns)) throw new BadRequestException("合同清单定义异常，请刷新后重试");
    const core: Array<[string, string, BusinessEntryFieldDefinition["type"], boolean, number]> = [
      ["itemCode", "编码", "text", false, 0], ["itemName", "名称", "text", true, 0],
      ["specification", "规格型号", "text", false, 0], ["unit", "单位", "text", true, 0],
      ["quantity", "数量", "number", false, bill.quantityScale],
      ["unitPrice", "含税单价", "money", false, bill.unitPriceScale],
      ["taxRateSource", "税率来源", "single_select", false, 0],
      ["taxRatePercent", "税率", "number", false, 6],
      ["isProvisional", "暂定项", "boolean", false, 0],
      ["settlementBasis", "结算依据", "text", false, 0]
    ];
    const fields = core.map(([key, label, type, required, precision], index) => ({
      ...headerField(key, schema.columns.find((column) => column.key === key)?.label ?? label, type, index + 1),
      scope: "line" as const, required, precision,
      excel: { column: ({ itemCode: "项目编号", itemName: "项目名称", unitPrice: "含税单价(元)", taxRatePercent: "税率(%)", isProvisional: "是否暂定" } as Record<string, string>)[key] ?? label,
        paste: "multi" as const, errorLocation: "cell" as const },
      ...(key === "taxRateSource" ? { options: [{ value: "version_default", label: "使用合同税率" }, { value: "row_override", label: "使用例外税率" }] } : {}),
      bulk: { enabled: true, strategy: "append" as const }
    }));
    for (const column of schema.columns.filter((column) => isContractBillCustomColumn(column.key))) {
      fields.push({ ...headerField(column.key, column.label, column.type, fields.length + 1),
        scope: "line", required: column.required ?? false,
        excel: { column: column.label, paste: "multi", errorLocation: "cell" },
        bulk: { enabled: true, strategy: "append" } });
    }
    const definition: BusinessEntrySceneDefinition = {
      key: "contract_bill_row", entityType: "contract_bill_row", name: bill.name,
      description: "合同清单行，计算与校验沿原清单规则执行。", version: template.definition.version,
      source: { ...template.definition.source!, billKey: bill.billKey }, fields, rules: []
    };
    return { billId: bill.id, billKey: bill.billKey, definition };
  });
}
