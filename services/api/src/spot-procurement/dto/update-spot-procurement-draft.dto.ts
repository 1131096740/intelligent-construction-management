import { IsInt, IsOptional, Min } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";
import { SpotProcurementDraftDto } from "./create-spot-procurement.dto";
export class SpotProcurementSubmissionDto {
  @IsOptional()
  @IsInt({message: "草稿修订版本必须是整数"})
  @Min(1, {message: "草稿修订版本不正确"})
  expectedDraftRevision?: number;
  @IsOptional()
  @IsRequiredText({requiredMessage: "请重新读取当前采购申请", typeMessage: "当前采购申请版本不正确", blankMessage: "请重新读取当前采购申请"})
  expectedVersionId?: string;
}
export class UpdateSpotProcurementDraftDto extends SpotProcurementDraftDto {
  @IsOptional()
  @IsInt({message: "草稿修订版本必须是整数"})
  @Min(1, {message: "草稿修订版本不正确"})
  expectedDraftRevision?: number;
  @IsOptional()
  @IsRequiredText({requiredMessage: "请重新读取当前采购申请", typeMessage: "当前采购申请版本不正确", blankMessage: "请重新读取当前采购申请"})
  expectedVersionId?: string;
}
