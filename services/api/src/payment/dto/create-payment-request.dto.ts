import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class CreatePaymentRequestDto {
  @IsOptional()
  @IsIn(["settlement", "contract_advance", "contract_due"], {
    message: "付款来源类型不正确"
  })
  sourceType?: "settlement" | "contract_advance" | "contract_due";

  @IsOptional()
  @IsString({ message: "结算单编号必须是文字" })
  @IsNotEmpty({ message: "结算单编号不能为空" })
  settlementId?: string;

  @IsOptional()
  @IsString({ message: "合同版本编号必须是文字" })
  @IsNotEmpty({ message: "合同版本编号不能为空" })
  contractVersionId?: string;

  @IsOptional()
  @IsString({ message: "付款条款版本编号必须是文字" })
  @IsNotEmpty({ message: "付款条款版本编号不能为空" })
  paymentTermsVersionId?: string;

  @IsString({ message: "付款单号必须是文字" })
  @IsNotEmpty({ message: "付款单号不能为空" })
  code!: string;

  @IsString({ message: "付款申请金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "付款申请金额必须按分填写为 0 或更大的整数" })
  requestedAmountCents!: string;
}
