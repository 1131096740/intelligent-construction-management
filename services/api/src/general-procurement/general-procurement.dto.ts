import { Type } from "class-transformer";
import { IsIn, IsInt, IsUUID, MaxLength, Max, Min, IsOptional, IsString, IsArray, ArrayMaxSize, ValidateNested } from "class-validator";
import { GENERAL_PROCUREMENT_CATEGORIES, type GeneralProcurementCategory } from "@jiangkong/shared-domain";
import { IsCanonicalMoneyText, IsRequiredText } from "../validation/static-field-validation";

export class GeneralProcurementLineDto {
  @IsUUID("4", { message: "清单行标识已失效，请重新添加" }) id!: string;
  @IsRequiredText({ requiredMessage: "请填写采购名称", typeMessage: "采购名称必须是文字", blankMessage: "采购名称不能为空白" })
  @MaxLength(500, { message: "采购名称最多五百字" }) name!: string;
  @IsOptional() @IsString({ message: "规格型号必须是文字" }) @MaxLength(500, { message: "规格型号最多五百字" }) specification?: string | null;
  @IsOptional() @IsString({ message: "单位必须是文字" }) @MaxLength(50, { message: "单位最多五十字" }) unit?: string | null;
  @IsOptional() @IsString({ message: "数量请使用十进制文字" }) @MaxLength(100, { message: "数量超出范围" }) quantity?: string | null;
  @IsOptional() @IsString({ message: "预计单价请使用十进制文字" }) @MaxLength(100, { message: "预计单价超出范围" }) unitPrice?: string | null;
  @IsOptional() @IsString({ message: "预计总价请使用十进制文字" }) @MaxLength(100, { message: "预计总价超出范围" }) estimatedAmount?: string | null;
  @IsOptional() @IsString({ message: "到位日期必须是日期文字" }) @MaxLength(10, { message: "到位日期格式不正确" }) requiredOn?: string | null;
  @IsOptional() @IsString({ message: "采购说明必须是文字" }) @MaxLength(2000, { message: "采购说明最多两千字" }) note?: string | null;
}
export class GeneralProcurementDraftDto {
  @IsOptional() @IsIn([2], { message: "申请协议已更新，请刷新页面" }) requestProtocolVersion?: 2;
  @IsOptional() @IsIn(["project", "company_daily"], { message: "请选择项目采购或公司日常采购" }) scope?: "project" | "company_daily";
  @IsOptional() @IsString({ message: "请选择有效项目" }) @MaxLength(128, { message: "项目标识超出长度限制" }) projectId?: string | null;
  @IsOptional() @IsUUID("4", { message: "请选择费用承担公司" }) companyEntityId?: string | null;
  @IsIn(GENERAL_PROCUREMENT_CATEGORIES.map((item) => item.key), { message: "请选择费用类别" }) category!: GeneralProcurementCategory;
  @IsOptional() @IsString({ message: "用途必须是文字" }) @MaxLength(4000, { message: "用途说明最多四千字" }) reason?: string;
  @IsOptional() @IsString({ message: "整单预计金额请使用十进制元文字" }) @MaxLength(100, { message: "整单预计金额超出范围" }) estimatedAmount?: string | null;
  @IsOptional() @IsCanonicalMoneyText({ typeMessage: "预计金额格式不正确", formatMessage: "请填写有效的预计金额" }) requestedAmountCents?: string | null;
  @IsOptional() @IsArray({ message: "采购清单格式不正确" }) @ArrayMaxSize(500, { message: "一次最多填写五百行采购清单" })
  @ValidateNested({ each: true }) @Type(() => GeneralProcurementLineDto) lines?: GeneralProcurementLineDto[];
}
export class CreateGeneralProcurementDto extends GeneralProcurementDraftDto {
  @IsUUID("4", { message: "提交标识已失效，请刷新后重试" }) requestKey!: string;
}
export class GeneralProcurementRevisionDto {
  @IsInt({ message: "页面版本已失效，请刷新" }) @Min(1, { message: "请刷新页面后重试" }) revision!: number;
}

export class ReviewGeneralProcurementDto extends GeneralProcurementRevisionDto {
  @IsOptional() @IsInt({ message: "审批职责已失效，请刷新" }) @Min(0, { message: "审批职责已失效，请刷新" }) expectedNodeIndex?: number;
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
  @IsOptional() @IsIn(["all", "drafts", "approval_pending", "approved_pending_archive", "approved_pending_procurement", "archived"], { message: "申请状态格式不正确" }) status?: string;
}
