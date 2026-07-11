import { IsDateString, IsInt, Max, Min } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RecordProjectOwnerContractDto {
  @IsRequiredText({
    requiredMessage: "业主名称不能为空",
    typeMessage: "业主名称必须是文字",
    blankMessage: "业主名称不能为空白"
  })
  ownerName!: string;

  @IsRequiredText({
    requiredMessage: "业主合同名称不能为空",
    typeMessage: "业主合同名称必须是文字",
    blankMessage: "业主合同名称不能为空白"
  })
  contractName!: string;

  @IsRequiredText({
    requiredMessage: "业主合同编号不能为空",
    typeMessage: "业主合同编号必须是文字",
    blankMessage: "业主合同编号不能为空白"
  })
  contractCode!: string;

  @IsDateString({ strict: true }, { message: "业主合同签订日期格式不正确" })
  signedAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "业主合同金额格式不正确",
    formatMessage: "业主合同金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsInt({ message: "税率必须是整数" })
  @Min(0, { message: "税率不能小于 0" })
  @Max(10_000, { message: "税率不能大于 10000" })
  taxRateBps!: number;

  @IsRequiredText({
    requiredMessage: "计价方式不能为空",
    typeMessage: "计价方式必须是文字",
    blankMessage: "计价方式不能为空白"
  })
  pricingMethod!: string;

  @IsRequiredText({
    requiredMessage: "付款条款摘要不能为空",
    typeMessage: "付款条款摘要必须是文字",
    blankMessage: "付款条款摘要不能为空白"
  })
  paymentTermsSummary!: string;

  @IsRequiredText({
    requiredMessage: "质保金摘要不能为空",
    typeMessage: "质保金摘要必须是文字",
    blankMessage: "质保金摘要不能为空白"
  })
  retentionSummary!: string;

  @IsRequiredText({
    requiredMessage: "业主合同文件不能为空",
    typeMessage: "业主合同文件编号必须是文字",
    blankMessage: "业主合同文件不能为空白"
  })
  fileId!: string;
}
