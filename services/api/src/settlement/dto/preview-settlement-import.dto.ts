import { IsRequiredText } from "../../validation/static-field-validation";

export class PreviewSettlementImportDto {
  @IsRequiredText({
    requiredMessage: "请选择要导入的结算 Excel 文件",
    typeMessage: "结算 Excel 文件编号必须是文字",
    blankMessage: "请选择要导入的结算 Excel 文件"
  })
  fileId!: string;
}
