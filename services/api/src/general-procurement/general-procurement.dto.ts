import { Type } from "class-transformer";
import { IsIn, IsInt, IsUUID, MaxLength, Max, Min, IsOptional, IsString } from "class-validator";
import { GENERAL_PROCUREMENT_CATEGORIES, type GeneralProcurementCategory } from "@jiangkong/shared-domain";
import { IsCanonicalMoneyText, IsRequiredText } from "../validation/static-field-validation";

export class GeneralProcurementDraftDto {
  @IsUUID("4", { message: "请选择所属项目" }) projectId!: string;
  @IsUUID("4", { message: "请选择费用承担公司" }) companyEntityId!: string;
  @IsIn(GENERAL_PROCUREMENT_CATEGORIES.map((item) => item.key), { message: "请选择费用类别" }) category!: GeneralProcurementCategory;
  @IsRequiredText({ requiredMessage: "请填写用途和具体需求", typeMessage: "用途必须是文字", blankMessage: "用途不能为空白" })
  @MaxLength(4000, { message: "用途说明最多四千字" }) reason!: string;
  @IsCanonicalMoneyText({ typeMessage: "申请金额格式不正确", formatMessage: "请填写有效的申请金额" }) requestedAmountCents!: string;
}
export class CreateGeneralProcurementDto extends GeneralProcurementDraftDto {
  @IsUUID("4", { message: "提交标识已失效，请刷新后重试" }) requestKey!: string;
}
export class GeneralProcurementRevisionDto {
  @IsInt({ message: "页面版本已失效，请刷新" }) @Min(1, { message: "请刷新页面后重试" }) revision!: number;
}

export class ReviewGeneralProcurementDto extends GeneralProcurementRevisionDto {
  @IsIn(["approve", "return"], { message: "请选择有效审批决定" }) decision!: "approve" | "return";
  @IsOptional() @IsString({ message: "审批意见必须是文字" }) @MaxLength(500, { message: "填写内容最多五百字" }) comment?: string;
  @IsOptional() @IsString({ message: "自审原因必须是文字" }) @MaxLength(500, { message: "填写内容最多五百字" }) selfReviewReason?: string;
  @IsOptional() @IsString({ message: "当前密码格式不正确" }) @MaxLength(256, { message: "密码格式不正确" }) confirmationPassword?: string;
}

export class UpdateGeneralProcurementDto extends GeneralProcurementDraftDto {
  @IsInt({ message: "页面版本已失效，请刷新" }) @Min(1, { message: "请刷新页面后重试" }) revision!: number;
}
export class WithdrawGeneralProcurementDto extends GeneralProcurementRevisionDto {
  @IsRequiredText({ requiredMessage: "请填写撤回原因", typeMessage: "撤回原因必须是文字", blankMessage: "请填写撤回原因" }) @MaxLength(500, { message: "填写内容最多五百字" }) reason!: string;
}

export class ArchiveGeneralProcurementDto extends GeneralProcurementRevisionDto {
  @IsUUID("4", { message: "请上传归档依据" }) fileId!: string;
  @IsRequiredText({ requiredMessage: "请填写归档说明", typeMessage: "归档说明必须是文字", blankMessage: "请填写归档说明" }) @MaxLength(1000, { message: "归档说明最多一千字" }) note!: string;
}

export class CancelProcurementPaymentDto {
  @IsRequiredText({ requiredMessage: "请填写撤销原因", typeMessage: "撤销原因必须是文字", blankMessage: "请填写撤销原因" })
  @MaxLength(500, { message: "撤销原因最多五百字" }) reason!: string;
}

export class ListGeneralProcurementDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: "页码格式不正确" }) @Min(1, { message: "页码须大于零" }) @Max(1000000, { message: "页码超出范围" }) page = 1;
  @IsOptional() @Type(() => Number) @IsInt({ message: "每页条数格式不正确" }) @Min(1, { message: "每页至少一条" }) @Max(100, { message: "每页最多一百条" }) pageSize = 20;
  @IsOptional() @IsString({ message: "搜索内容必须是文字" }) @MaxLength(200, { message: "搜索内容最多二百字" }) search?: string;
  @IsOptional() @IsIn(["all", "drafts", "approval_pending", "approved_pending_archive", "archived"], { message: "申请状态格式不正确" }) status?: string;
}
