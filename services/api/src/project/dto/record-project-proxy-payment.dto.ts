import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf
} from "class-validator";

export type ProjectProxyPaymentType =
  | "material"
  | "equipment"
  | "labor"
  | "professional_subcontract"
  | "other";

export class RecordProjectProxyPaymentDto {
  @IsDateString({}, { message: "代付日期格式不正确" })
  paidAt!: string;

  @IsString({ message: "代付金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "代付金额必须按分填写为 0 或更大的整数" })
  amountCents!: string;

  @IsString({ message: "总包单位名称必须是文字" })
  @IsNotEmpty({ message: "总包单位名称不能为空" })
  @Matches(/\S/u, { message: "总包单位名称不能为空白" })
  generalContractorName!: string;

  @IsString({ message: "代付对象名称必须是文字" })
  @IsNotEmpty({ message: "代付对象名称不能为空" })
  @Matches(/\S/u, { message: "代付对象名称不能为空白" })
  paidTargetName!: string;

  @IsIn(["material", "equipment", "labor", "professional_subcontract", "other"], {
    message: "代付类型不正确"
  })
  paymentType!: ProjectProxyPaymentType;

  @IsOptional()
  @IsString({ message: "代付说明必须是文字" })
  description?: string;

  @IsString({ message: "代付凭证编号必须是文字" })
  @IsNotEmpty({ message: "代付凭证不能为空" })
  @Matches(/\S/u, { message: "代付凭证不能为空白" })
  voucherFileId!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "关联合同编号必须是文字" })
  @IsNotEmpty({ message: "关联合同编号不能为空" })
  @Matches(/\S/u, { message: "关联合同编号不能为空白" })
  contractId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "关联结算编号必须是文字" })
  @IsNotEmpty({ message: "关联结算编号不能为空" })
  @Matches(/\S/u, { message: "关联结算编号不能为空白" })
  settlementId?: string;
}
