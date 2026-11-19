import { BadRequestException } from "@nestjs/common";

export const CONTRACT_DRAFT_BUSINESS_TYPES = ["material_purchase", "equipment_rental", "labor_subcontract", "professional_subcontract", "other"] as const;

/** Draft-only template classification. Never rewrites a formal contract classification. */
export function resolveContractDraftBusinessType(
  draftData: unknown,
  parentType: string | null,
  signingSubjectType?: string
): string {
  const draft = draftData && typeof draftData === "object" && !Array.isArray(draftData) ? draftData as Record<string, unknown> : {};
  const rawBasics = draft.contractBasics;
  if (rawBasics !== undefined && (!rawBasics || typeof rawBasics !== "object" || Array.isArray(rawBasics))) {
    throw new BadRequestException("合同基础资料格式不正确，请刷新后重试");
  }
  const basics = rawBasics as Record<string, unknown> | undefined;
  const businessType = basics?.businessType;
  if (typeof businessType === "string" && CONTRACT_DRAFT_BUSINESS_TYPES.includes(businessType as typeof CONTRACT_DRAFT_BUSINESS_TYPES[number])) return businessType;
  if (businessType !== undefined || signingSubjectType === "draft_unconfirmed") {
    throw new BadRequestException("请选择当前草稿的业务类型，没有合适类型时请选择其他");
  }
  if (parentType?.trim()) return parentType;
  throw new BadRequestException("合同业务类型待补充，请先填写后再选择模板");
}
