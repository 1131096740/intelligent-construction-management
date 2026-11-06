import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsISO8601, IsOptional, IsInt, Min, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from "class-validator";
import { IsCanonicalMoneyText } from "../../validation/static-field-validation";

class RegisteredPaymentSourceAllocationDto {
  @IsUUID("4", { message: "请选择有效的资金来源" }) sourceBatchId!: string;
  @IsCanonicalMoneyText({ typeMessage: "来源分摊金额格式不正确", formatMessage: "来源分摊金额须为整数分" }) amountCents!: string;
}

class ExistingRegisteredPaymentSourceDto {
  @IsIn(["contract_takeover_historical_payment", "historical_financial_takeover_row"]) type!: string;
  @IsUUID("4") id!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(64) @MaxLength(64) expectedFingerprint!: string;
}

class RegisteredContractHistoryConfirmationDto {
  @IsIn(["not_included", "included", "uncertain"], {message:"请选择本次实付与合同历史已付的核对结果"}) treatment!: "not_included" | "included" | "uncertain";
  @IsString({message:"合同历史核对版本格式不正确，请刷新资料"}) @MinLength(64,{message:"合同历史核对版本格式不正确，请刷新资料"}) @MaxLength(64,{message:"合同历史核对版本格式不正确，请刷新资料"}) expectedFingerprint!: string;
  @IsString({message:"请填写合同历史独立核对原因"}) @MinLength(1,{message:"请填写合同历史独立核对原因"}) @MaxLength(500,{message:"合同历史独立核对原因不能超过500字"}) reason!: string;
  @IsString({message:"请填写合同历史独立核对依据"}) @MinLength(1,{message:"请填写合同历史独立核对依据"}) @MaxLength(1000,{message:"合同历史独立核对依据不能超过1000字"}) evidence!: string;
}

export class RecordRegisteredPaymentExecutionDto {
  @IsOptional() @ValidateNested({message:"合同历史独立核对资料格式不正确"}) @Type(() => RegisteredContractHistoryConfirmationDto) contractHistoryConfirmation?: RegisteredContractHistoryConfirmationDto;
  @IsOptional() @ValidateNested() @Type(() => ExistingRegisteredPaymentSourceDto) existingSource?: ExistingRegisteredPaymentSourceDto;
  @IsUUID("4", { message: "付款登记请求格式不正确" }) idempotencyKey!: string;
  @IsISO8601({}, { message: "付款申请版本格式不正确" }) expectedPaymentUpdatedAt!: string;
  @IsCanonicalMoneyText({ typeMessage: "实付金额格式不正确", formatMessage: "实付金额须为整数分" }) amountCents!: string;
  @IsDateString({ strict: true }, { message: "付款日期格式不正确" }) paidAt!: string;
  @IsString() @MinLength(1) @MaxLength(200) scopeKey!: string;
  @IsUUID("4", { message: "请重新选择有效的余额核对版本" }) expectedRegistrationId!: string;
  @IsIn(["included", "not_included"], { message: "请先确认此次实付已含或未含期初；无法确认可保留填写" }) openingTreatment!: "included" | "not_included";
  @IsString() @MinLength(1) @MaxLength(500) openingReason!: string;
  @IsString() @MinLength(1) @MaxLength(1000) openingEvidence!: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RegisteredPaymentSourceAllocationDto) sourceAllocations!: RegisteredPaymentSourceAllocationDto[];
  @IsString() @MinLength(1) @MaxLength(200) confirmationPassword!: string;
}
