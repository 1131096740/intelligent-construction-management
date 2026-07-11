import { IsDateString, IsInt, IsNotEmpty, IsString, Matches, Max, Min } from "class-validator";

export class RecordProjectOwnerContractDto {
  @IsString({ message: "业主名称必须是文字" })
  @IsNotEmpty({ message: "业主名称不能为空" })
  @Matches(/\S/u, { message: "业主名称不能为空白" })
  ownerName!: string;

  @IsString({ message: "业主合同名称必须是文字" })
  @IsNotEmpty({ message: "业主合同名称不能为空" })
  @Matches(/\S/u, { message: "业主合同名称不能为空白" })
  contractName!: string;

  @IsString({ message: "业主合同编号必须是文字" })
  @IsNotEmpty({ message: "业主合同编号不能为空" })
  @Matches(/\S/u, { message: "业主合同编号不能为空白" })
  contractCode!: string;

  @IsDateString({}, { message: "业主合同签订日期格式不正确" })
  signedAt!: string;

  @IsString({ message: "业主合同金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "业主合同金额必须按分填写为 0 或更大的整数" })
  amountCents!: string;

  @IsInt({ message: "税率必须是整数" })
  @Min(0, { message: "税率不能小于 0" })
  @Max(10_000, { message: "税率不能大于 10000" })
  taxRateBps!: number;

  @IsString({ message: "计价方式必须是文字" })
  @IsNotEmpty({ message: "计价方式不能为空" })
  @Matches(/\S/u, { message: "计价方式不能为空白" })
  pricingMethod!: string;

  @IsString({ message: "付款条款摘要必须是文字" })
  @IsNotEmpty({ message: "付款条款摘要不能为空" })
  @Matches(/\S/u, { message: "付款条款摘要不能为空白" })
  paymentTermsSummary!: string;

  @IsString({ message: "质保金摘要必须是文字" })
  @IsNotEmpty({ message: "质保金摘要不能为空" })
  @Matches(/\S/u, { message: "质保金摘要不能为空白" })
  retentionSummary!: string;

  @IsString({ message: "业主合同文件编号必须是文字" })
  @IsNotEmpty({ message: "业主合同文件不能为空" })
  @Matches(/\S/u, { message: "业主合同文件不能为空白" })
  fileId!: string;
}
