import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsIntegerInRange,
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

export type ContractTakeoverExcessTreatment =
  | "historical_advance"
  | "abnormal_overpay";

export class HistoricalPaymentInput {
  @IsRequiredText({
    requiredMessage: "历史实付行标识不能为空",
    typeMessage: "历史实付行标识必须是文字",
    blankMessage: "历史实付行标识不能为空"
  })
  rowKey!: string;

  @IsCanonicalMoneyText({
    typeMessage: "历史实付金额格式不正确",
    formatMessage: "历史实付金额必须按分填写为大于 0 的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "请按 YYYY-MM-DD 填写历史实付日期",
    typeMessage: "历史实付日期必须是文字",
    blankMessage: "请按 YYYY-MM-DD 填写历史实付日期"
  })
  @IsStrictDateOnly({
    message: "历史实付日期必须按 YYYY-MM-DD 填写且日期必须有效"
  })
  paidAt!: string;

  @IsOptionalNonBlankText({
    typeMessage: "付款单位必须是文字",
    blankMessage: "付款单位不能只包含空白字符"
  })
  payerName?: string;

  @IsOptionalNonBlankText({
    typeMessage: "收款单位必须是文字",
    blankMessage: "收款单位不能只包含空白字符"
  })
  payeeName?: string;

  @IsOptionalNonBlankText({
    typeMessage: "银行流水说明必须是文字",
    blankMessage: "银行流水说明不能只包含空白字符"
  })
  bankReference?: string;

  @IsOptionalNonBlankText({
    typeMessage: "付款方式必须是文字",
    blankMessage: "付款方式不能只包含空白字符"
  })
  paymentMethod?: string;

  @IsOptionalNonBlankText({
    typeMessage: "历史实付备注必须是文字",
    blankMessage: "历史实付备注不能只包含空白字符"
  })
  note?: string;

  @IsArray({ message: "历史实付凭证必须是数组" })
  @ArrayMinSize(1, { message: "每笔历史实付至少需要一份付款凭证" })
  @ArrayMaxSize(50, { message: "每笔历史实付最多上传 50 份付款凭证" })
  @ArrayUnique({ message: "同一笔历史实付不能重复使用付款凭证" })
  @IsString({ each: true, message: "历史实付凭证标识必须是文字" })
  @Matches(/\S/u, {
    each: true,
    message: "历史实付凭证标识不能为空白"
  })
  voucherFileIds!: string[];
}

export class SaveContractTakeoverFinanceFactsDto {
  @IsUUID("4", { message: "财务侧保存幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "财务侧修订必须是整数",
    rangeMessage: "财务侧修订必须大于等于 0"
  })
  expectedRevision!: number;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "合同侧修订必须是整数",
    rangeMessage: "合同侧修订必须大于 0"
  })
  basedOnContractRevision!: number;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "财务基线修订必须是整数",
    rangeMessage: "财务基线修订必须大于 0"
  })
  basedOnFinanceBasisRevision!: number;

  @IsBoolean({ message: "历史实付为零声明必须是布尔值" })
  zeroPaymentDeclared!: boolean;

  @IsOptional()
  @IsIn(["historical_advance", "abnormal_overpay"], {
    message: "历史实付超额分类不正确"
  })
  excessTreatment?: ContractTakeoverExcessTreatment;

  @IsOptionalNonBlankText({
    typeMessage: "历史实付超额分类原因必须是文字",
    blankMessage: "历史实付超额分类原因不能只包含空白字符"
  })
  excessReason?: string;

  @IsOptional()
  @IsArray({ message: "历史实付超额分类依据必须是数组" })
  @ArrayMaxSize(50, { message: "历史实付超额分类依据最多上传 50 份" })
  @ArrayUnique({ message: "历史实付超额分类依据不能重复" })
  @IsString({ each: true, message: "历史实付超额分类依据标识必须是文字" })
  @Matches(/\S/u, {
    each: true,
    message: "历史实付超额分类依据标识不能为空白"
  })
  excessEvidenceFileIds?: string[];

  @IsArray({ message: "逐笔历史实付必须是数组" })
  @ArrayMaxSize(500, { message: "单次最多录入 500 笔历史实付" })
  @ValidateNested({ each: true, message: "每笔历史实付必须是对象" })
  @Type(() => HistoricalPaymentInput)
  payments!: HistoricalPaymentInput[];
}
