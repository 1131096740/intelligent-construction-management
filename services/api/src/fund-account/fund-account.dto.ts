import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
export class FundAccountSourceDto {
  @IsString({ message: "来源金额请填写数字文本，最多保留四位小数" }) amountYuan!: string;
  @IsIn(["pending", "known"], { message: "请选择出资方已知或待核对" }) sourceStatus!: "pending" | "known";
  @IsOptional() @IsString({ message: "出资方名称请填写文字" }) @MaxLength(200, { message: "出资方名称请控制在二百字以内" }) sourceName?: string | null;
  @IsIn(["pending", "project", "company_daily"], { message: "请选择项目归属、公司日常或待核对" }) projectStatus!: "pending" | "project" | "company_daily";
  @IsOptional() @IsString({ message: "请从列表选择所属项目" }) projectId?: string | null;
  @IsOptional() @IsString({ message: "请从原登记来源列表选择对应来源" }) previousSourceBatchId?: string | null;
}
export class RegisterFundBalanceDto {
  @IsString({ message: "请选择公司资金或公共现金" }) @MaxLength(200, { message: "账户选择异常，请刷新后重选" }) scopeKey!: string;
  @IsOptional() @IsString({ message: "登记余额请填写数字文本，未知余额留空" }) balanceYuan?: string | null;
  @IsString({ message: "请填写真实核对日期" }) asOfDate!: string;
  @IsString({ message: "请填写核对依据" }) @MaxLength(1000, { message: "核对依据请控制在一千字以内" }) evidenceReference!: string;
  @IsString({ message: "请填写核对说明" }) @MaxLength(1000, { message: "核对说明请控制在一千字以内" }) reconciliationNote!: string;
  @IsString({ message: "请填写登记或更正原因" }) @MaxLength(1000, { message: "原因请控制在一千字以内" }) reason!: string;
  @IsString({ message: "提交凭据缺失，请保留输入后刷新重试" }) @MaxLength(100, { message: "提交凭据异常，请保留输入后刷新重试" }) idempotencyKey!: string;
  @IsArray({ message: "来源归属请按明细填写" }) @ValidateNested({ each: true, message: "来源归属明细不正确，请逐项核对" }) @Type(() => FundAccountSourceDto) sources!: FundAccountSourceDto[];
}
export class CorrectFundBalanceDto extends RegisterFundBalanceDto {
  @IsOptional() @IsArray({ message: "请明确本次核对已包含的实付清单" }) @ArrayMaxSize(1000) @IsUUID("4", { each: true, message: "已包含实付引用格式不正确" }) coveredExecutionIds?: string[];
  @IsString({ message: "原登记选择已失效，请刷新账户后核对" }) previousRegistrationId!: string;
}
export class ConfirmFundBalanceDto {
  @IsString({ message: "办理凭据缺失，请保留输入后重试" }) @MaxLength(100, { message: "办理凭据异常，请保留输入后重试" }) idempotencyKey!: string;
  @IsString({ message: "复核轮次已变化，请刷新后重试" }) @MaxLength(200, { message: "复核轮次选择异常，请刷新后重试" }) expectedApprovalInstanceId!: string;
  @IsOptional() @IsString({ message: "请填写本人发起事项的自审原因" }) @MaxLength(1000, { message: "自审原因请控制在一千字以内" }) selfReviewReason?: string;
  @IsString({ message: "请填写财务主管复核结论" }) @MaxLength(1000, { message: "复核结论请控制在一千字以内" }) reviewNote!: string;
  @IsOptional() @IsString({ message: "请填写本人当前密码" }) @MaxLength(200, { message: "当前密码格式不正确，请重新输入" }) confirmationPassword?: string;
}
