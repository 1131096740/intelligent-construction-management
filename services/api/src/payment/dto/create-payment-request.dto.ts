import { IsIn, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class CreatePaymentRequestDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["settlement", "contract_advance", "contract_due"], {
    message: "付款来源类型不正确"
  })
  sourceType?: "settlement" | "contract_advance" | "contract_due";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "结算单编号必须是文字" })
  @IsNotEmpty({ message: "结算单编号不能为空" })
  @Matches(/\S/u, { message: "结算单编号不能为空白" })
  settlementId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "合同版本编号必须是文字" })
  @IsNotEmpty({ message: "合同版本编号不能为空" })
  @Matches(/\S/u, { message: "合同版本编号不能为空白" })
  contractVersionId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "付款条款版本编号必须是文字" })
  @IsNotEmpty({ message: "付款条款版本编号不能为空" })
  @Matches(/\S/u, { message: "付款条款版本编号不能为空白" })
  paymentTermsVersionId?: string;

  @IsString({ message: "付款单号必须是文字" })
  @IsNotEmpty({ message: "付款单号不能为空" })
  @Matches(/\S/u, { message: "付款单号不能为空白" })
  code!: string;

  @IsString({ message: "付款申请金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "付款申请金额必须按分填写为 0 或更大的整数" })
  requestedAmountCents!: string;
}
