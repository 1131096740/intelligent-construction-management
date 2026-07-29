import { IsDateString, IsString, IsUUID } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RecordProjectAffiliateCompanyContractDto {
  @IsRequiredText({
    requiredMessage: "线下合同编号不能为空",
    typeMessage: "线下合同编号必须是文字",
    blankMessage: "线下合同编号不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 100, message: "线下合同编号不能超过 100 个字符" })
  contractReference!: string;

  @IsRequiredText({
    requiredMessage: "线下合同名称不能为空",
    typeMessage: "线下合同名称必须是文字",
    blankMessage: "线下合同名称不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 200, message: "线下合同名称不能超过 200 个字符" })
  contractName!: string;

  @IsDateString({ strict: true }, { message: "线下合同签订日期格式不正确" })
  signedAt!: string;

  @IsRequiredText({
    requiredMessage: "双方权利义务摘要不能为空",
    typeMessage: "双方权利义务摘要必须是文字",
    blankMessage: "双方权利义务摘要不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 2000,
    message: "双方权利义务摘要不能超过 2000 个字符"
  })
  rightsObligationsSummary!: string;

  @IsString({ message: "我方签约主体编号必须是文字" })
  companyEntityId!: string;

  @IsString({ message: "已签线下合同文件编号必须是文字" })
  fileId!: string;

  @IsUUID("4", { message: "线下合同登记幂等键必须是 UUID" })
  idempotencyKey!: string;
}
