import { IsIn, IsString, IsUUID } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export const PROJECT_AFFILIATE_BUSINESS_FACT_TYPES = [
  "contract",
  "settlement",
  "payment"
] as const;
export type ProjectAffiliateBusinessFactType =
  (typeof PROJECT_AFFILIATE_BUSINESS_FACT_TYPES)[number];

export class SupplementProjectAffiliateBusinessEvidenceDto {
  @IsIn(PROJECT_AFFILIATE_BUSINESS_FACT_TYPES, {
    message: "施工企业外部事实类型不正确"
  })
  businessType!: ProjectAffiliateBusinessFactType;

  @IsRequiredText({
    requiredMessage: "依据文件编号不能为空",
    typeMessage: "依据文件编号必须是文字",
    blankMessage: "依据文件编号不能为空白"
  })
  fileId!: string;

  @IsUUID("4", { message: "补充外部依据幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsString({ message: "补充依据说明必须是文字" })
  description!: string;
}
