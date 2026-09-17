import { contractFieldsForBusinessUse, isContractBillCustomColumn, type ContractBillDefinition, type ContractFieldDefinition, type BusinessEntryFieldDefinition, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { BadRequestException } from "@nestjs/common";
import type { ContractVersion, Prisma } from "@prisma/client";

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

export function contractBasicEntryValues(draftData: unknown) {
  const draft = draftData && typeof draftData === "object" && !Array.isArray(draftData)
    ? draftData as Record<string, unknown> : {};
  const selection = draft.companyEntitySelection;
  const company = selection && typeof selection === "object" && !Array.isArray(selection)
    ? selection as Record<string, unknown> : {};
  return {
    contractName: typeof draft.contractName === "string" ? draft.contractName : "",
    companyEntityId: typeof company.id === "string" ? company.id : ""
  };
}

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
