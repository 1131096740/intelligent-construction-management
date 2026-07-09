export const CONTRACT_DOCUMENT_REQUIRED_PLACEHOLDERS = [
  "contract.name",
  "contract.temporaryCode",
  "document.watermark"
] as const;

export const CONTRACT_VALUE_PLACEHOLDER_ALIASES: Record<string, string> = {
  合同名称: "contract.name",
  草稿编号: "contract.temporaryCode",
  合同编号: "contract.code",
  合同金额: "contract.amount",
  合同金额大写: "contract.amountUppercase",
  文档水印: "document.watermark",
  生成时间: "document.generatedAt",
  甲方名称: "party.owner.name",
  乙方名称: "party.counterparty.name",
  承包方名称: "party.counterparty.name",
  分包方名称: "party.counterparty.name",
  供应商名称: "party.counterparty.name",
  项目名称: "field.projectName",
  相对方名称: "field.counterpartyName",
  业务摘要: "field.businessSummary",
  交货地点: "field.deliveryLocation",
  交货期限: "field.deliveryDeadline",
  质量标准: "field.qualityStandard",
  结算方式: "field.settlementMethod",
  使用地点: "field.useLocation",
  租赁开始日期: "field.rentalStartDate",
  租赁结束日期: "field.rentalEndDate",
  结算周期: "field.settlementCycle",
  付款比例: "field.paymentRatioPercent",
  作业范围: "field.workScope",
  作业地点: "field.workLocation",
  计划开工日期: "field.plannedStartDate",
  计划完工日期: "field.plannedEndDate",
  进度付款比例: "field.progressPaymentRatioPercent",
  税率: "field.taxRatePercent",
  付款条款: "clause.payment.text",
  特别约定: "clause.specialAgreement.text",
  安全文明条款: "clause.safety.text",
  工资承诺条款: "clause.wageCommitment.text"
};

export const CONTRACT_BILL_PLACEHOLDER_ALIASES: Record<string, string> = {
  材料清单: "bill.materials",
  机械租赁清单: "bill.equipmentRentals",
  设备清单: "bill.equipmentRentals",
  劳务清单: "bill.laborItems",
  通用清单: "bill.genericItems"
};

export const CONTRACT_BILL_ROW_PLACEHOLDER_ALIASES: Record<string, string> = {
  编码: "itemCode",
  名称: "itemName",
  规格: "specification",
  规格型号: "specification",
  单位: "unit",
  数量: "quantity",
  单价: "unitPrice",
  税率: "taxRatePercent",
  金额: "taxInclusiveAmount",
  含税金额: "taxInclusiveAmount",
  备注: "remark"
};

const BILL_ROW_PLACEHOLDERS = new Set([
  ...Object.keys(CONTRACT_BILL_ROW_PLACEHOLDER_ALIASES),
  ...Object.values(CONTRACT_BILL_ROW_PLACEHOLDER_ALIASES),
  "unitPrice",
  "taxRate",
  "taxExclusiveAmount",
  "taxAmount"
]);

export function isContractBillRowPlaceholder(value: string) {
  return BILL_ROW_PLACEHOLDERS.has(value);
}

export function canonicalContractPlaceholder(tag: string) {
  const normalized = tag.replace(/^[#/]\s*/, "").trim();
  return (
    CONTRACT_VALUE_PLACEHOLDER_ALIASES[normalized] ??
    CONTRACT_BILL_PLACEHOLDER_ALIASES[normalized] ??
    normalized
  );
}

export function canonicalContractBillLoopKey(tag: string) {
  const alias = canonicalContractPlaceholder(tag.replace(/^#\s*/, ""));
  return alias.startsWith("bill.") ? alias.slice("bill.".length) : alias;
}
