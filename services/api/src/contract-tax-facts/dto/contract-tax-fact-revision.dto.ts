import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  ValidateNested
} from "class-validator";
import type {
  ContractInvoiceType,
  ContractTaxFactSource,
  ContractTaxMode
} from "@jiangkong/shared-domain";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ContractTaxFactRowDto {
  @IsRequiredText({
    requiredMessage: "请选择需要补录的合同清单行",
    typeMessage: "合同清单行标识必须是文字",
    blankMessage: "请选择需要补录的合同清单行"
  })
  contractBillRowId!: string;

  @IsOptionalNonBlankText({
    typeMessage: "含税单价必须是文字",
    blankMessage: "含税单价不能为空白"
  })
  taxInclusiveUnitPrice?: string;

  @IsOptionalNonBlankText({
    typeMessage: "例外税率必须是文字",
    blankMessage: "例外税率不能为空白"
  })
  taxRatePercentOverride?: string;
}

export class SaveContractTaxFactRevisionDto {
  @IsIn(["supplement", "correction"], {
    message: "税务事实修订类型不正确"
  })
  kind!: "supplement" | "correction";

  @IsOptional()
  @IsIn(["vat_general", "vat_special"], {
    message: "发票类型请选择增值税普通发票或增值税专用发票"
  })
  invoiceType?: ContractInvoiceType;

  @IsOptional()
  @IsIn(["single_rate", "multiple_rate"], {
    message: "计税模式请选择单一税率或特殊多税率"
  })
  taxMode?: ContractTaxMode;

  @IsOptionalNonBlankText({
    typeMessage: "默认税率必须是文字",
    blankMessage: "默认税率不能为空白"
  })
  defaultTaxRatePercent?: string;

  @IsOptional()
  @IsIn(
    ["contract_document", "supplement_evidence", "business_finance_confirmation"],
    { message: "税务事实来源不在系统支持范围内" }
  )
  source?: ContractTaxFactSource;

  @IsOptionalNonBlankText({
    typeMessage: "确认说明必须是文字",
    blankMessage: "确认说明不能为空白"
  })
  confirmationExplanation?: string;

  @IsOptionalNonBlankText({
    typeMessage: "依据附件标识必须是文字",
    blankMessage: "依据附件标识不能为空白"
  })
  evidenceFileId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "更正原因必须是文字",
    blankMessage: "更正原因不能为空白"
  })
  correctionReason?: string;

  @IsOptional()
  @IsArray({ message: "清单价格事实必须是数组" })
  @ArrayMaxSize(2000, { message: "单次最多补录 2000 条清单价格事实" })
  @ValidateNested({ each: true, message: "每条清单价格事实必须是对象" })
  @Type(() => ContractTaxFactRowDto)
  rowFacts?: ContractTaxFactRowDto[];
}

export class ReviewContractTaxFactRevisionDto {
  @IsIn(["approve", "reject"], { message: "复核结论不在系统支持范围内" })
  decision!: "approve" | "reject";

  @IsOptionalNonBlankText({
    typeMessage: "复核意见必须是文字",
    blankMessage: "复核意见不能为空白"
  })
  comment?: string;
}
