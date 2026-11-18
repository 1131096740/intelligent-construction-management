import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";
import { FUND_ACCOUNT_TRANSFER_ACTIONS, type FundAccountTransferAction } from "./fund-account-transfer-state";

export class FundAccountTransferLineDto {
  @IsUUID("4", { message: "资金来源已变化，请刷新后重新选择" }) sourceBatchId!: string;
  @IsString({ message: "请填写该来源的转款金额" }) amountYuan!: string;
}

export class RegisterFundAccountTransferDto {
  @IsString() @MaxLength(200) sourceScopeKey!: string;
  @IsString() @MaxLength(200) destinationScopeKey!: string;
  @IsUUID("4") expectedRegistrationId!: string;
  @IsUUID("4") idempotencyKey!: string;
  @IsString() transferredOn!: string;
  @IsString() @MaxLength(1000) evidenceReference!: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => FundAccountTransferLineDto)
  lines!: FundAccountTransferLineDto[];
}

export class ActOnFundAccountTransferDto {
  @IsUUID("4") idempotencyKey!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsIn(FUND_ACCOUNT_TRANSFER_ACTIONS) action!: FundAccountTransferAction;
  @IsString() @MaxLength(1000) evidenceReference!: string;
}
