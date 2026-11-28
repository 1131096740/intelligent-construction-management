import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from "class-validator";

const amountPattern = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,4})?$/u;
const amountMessage = "请填写准确金额，最多保留4位小数";
const reasonMessage = "请填写归还办理依据";

export class ApplyPrincipalReturnDto {
  @IsIn(["advance_receipt", "payment_advance"], {message:"请选择原垫资来源"})
  sourceKind!: "advance_receipt" | "payment_advance";

  @IsUUID("4", {message:"原垫资资料不正确"})
  sourceId!: string;

  @Matches(amountPattern, {message:amountMessage})
  amountYuan!: string;

  @Length(1, 1000, {message:reasonMessage})
  reason!: string;

  @IsUUID("4", {message:"请求标识不正确，请刷新后重试"})
  idempotencyKey!: string;
}

export class ActPrincipalReturnDto {
  @IsIn(["approve", "reject", "withdraw", "reduce"], {message:"请选择有效办理动作"})
  action!: "approve" | "reject" | "withdraw" | "reduce";

  @IsInt({message:"归还申请版本不正确"})
  @Min(1, {message:"归还申请版本不正确"})
  expectedRevision!: number;

  @IsOptional()
  @IsInt({message:"审批岗位不正确"})
  @Min(0, {message:"审批岗位不正确"})
  nodeIndex?: number;

  @Length(1, 1000, {message:reasonMessage})
  reason!: string;

  @IsOptional()
  @IsString({message:"请输入本人密码"})
  @MaxLength(128, {message:"本人密码长度不正确"})
  confirmationPassword?: string;

  @IsOptional()
  @Matches(amountPattern, {message:amountMessage})
  reducedYuan?: string;

  @IsUUID("4", {message:"请求标识不正确，请刷新后重试"})
  idempotencyKey!: string;
}

class PrincipalReturnAllocationDto {
  @IsUUID("4", {message:"资金来源格式不正确"})
  sourceBatchId!: string;

  @Matches(amountPattern, {message:amountMessage})
  amountYuan!: string;
}

export class PayPrincipalReturnDto {
  @IsInt({message:"归还申请版本不正确"})
  @Min(1, {message:"归还申请版本不正确"})
  expectedRevision!: number;

  @Length(1, 128, {message:"请选择实际付款资金"})
  scopeKey!: string;

  @IsUUID("4", {message:"余额核对版本不正确"})
  expectedRegistrationId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/u, {message:"请选择实际归还日期"})
  paidOn!: string;

  @Matches(amountPattern, {message:amountMessage})
  amountYuan!: string;

  @IsArray({message:"请逐项填写实际资金来源"})
  @ArrayMinSize(1, {message:"请逐项填写实际资金来源"})
  @ArrayMaxSize(100, {message:"最多填写一百项资金来源"})
  @ValidateNested({each:true})
  @Type(() => PrincipalReturnAllocationDto)
  sourceAllocations!: PrincipalReturnAllocationDto[];

  @Length(1, 1000, {message:reasonMessage})
  evidenceReference!: string;

  @Length(1, 128, {message:"请输入本人密码"})
  confirmationPassword!: string;

  @IsUUID("4", {message:"请求标识不正确，请刷新后重试"})
  idempotencyKey!: string;
}
