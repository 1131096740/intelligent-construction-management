import { Type } from "class-transformer";
import { IsBoolean, IsInt, ValidateNested, Min } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class SettlementCounterpartyDeclarationDto {
  @IsBoolean({ message: "请确认扫描件页序与冻结版一致" })
  pageOrderMatchesFrozenDocument!: boolean;

  @IsBoolean({ message: "请确认乙方已在所有要求位置签字并填写日期" })
  counterpartySignedAndDated!: boolean;

  @IsBoolean({ message: "请确认乙方已逐页盖章" })
  everyPageStamped!: boolean;

  @IsBoolean({ message: "请确认多页文件已加盖骑缝章" })
  crossPageSealCompleted!: boolean;
}

export class LinkSettlementCounterpartySignedDocumentDto {
  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "请选择当前冻结版结算单",
    typeMessage: "冻结版结算单编号必须是文字",
    blankMessage: "请选择当前冻结版结算单"
  })
  frozenDocumentId!: string;

  @IsRequiredText({
    requiredMessage: "请选择乙方完整签章扫描件",
    typeMessage: "乙方扫描件编号必须是文字",
    blankMessage: "请选择乙方完整签章扫描件"
  })
  uploadedFileId!: string;

  @ValidateNested()
  @Type(() => SettlementCounterpartyDeclarationDto)
  declaration!: SettlementCounterpartyDeclarationDto;
}
