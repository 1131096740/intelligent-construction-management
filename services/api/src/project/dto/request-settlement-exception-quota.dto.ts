import { IsDateString, IsNotEmpty, IsString, Matches } from "class-validator";

export class RequestSettlementExceptionQuotaDto {
  @IsString({ message: "合同编号必须是文字" })
  @IsNotEmpty({ message: "合同编号不能为空" })
  @Matches(/\S/u, { message: "合同编号不能为空白" })
  contractId!: string;

  @IsString({ message: "结算例外额度格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "结算例外额度必须按分填写为 0 或更大的整数" })
  amountCents!: string;

  @IsString({ message: "额度申请原因必须是文字" })
  @IsNotEmpty({ message: "请填写额度申请原因" })
  @Matches(/\S/u, { message: "请填写额度申请原因" })
  reason!: string;

  @IsDateString({ strict: true }, { message: "额度有效期格式不正确" })
  validUntil!: string;

  @IsString({ message: "额度附件编号必须是文字" })
  @IsNotEmpty({ message: "额度附件不能为空" })
  @Matches(/\S/u, { message: "额度附件不能为空白" })
  attachmentFileId!: string;
}
