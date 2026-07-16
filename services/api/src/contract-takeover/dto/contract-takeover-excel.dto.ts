import {
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

export class PreviewContractTakeoverExcelDto {
  @IsRequiredText({
    requiredMessage: "请选择历史合同导入文件",
    typeMessage: "导入文件标识必须是文字",
    blankMessage: "请选择历史合同导入文件"
  })
  fileId!: string;
}

export class ApplyContractTakeoverExcelDto extends PreviewContractTakeoverExcelDto {
  @IsRequiredText({
    requiredMessage: "缺少文件校验值，请重新预检",
    typeMessage: "文件校验值必须是文字",
    blankMessage: "缺少文件校验值，请重新预检"
  })
  fileSha256!: string;

  @IsRequiredText({
    requiredMessage: "缺少导入预检标识，请重新预检",
    typeMessage: "导入预检标识必须是文字",
    blankMessage: "缺少导入预检标识，请重新预检"
  })
  importFingerprint!: string;

  @IsRequiredText({
    requiredMessage: "请填写接管截止日后再生成接管草稿",
    typeMessage: "接管截止日必须是文字",
    blankMessage: "请填写接管截止日后再生成接管草稿"
  })
  @IsStrictDateOnly({ message: "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效" })
  takeoverCutoffDate!: string;

  @IsRequiredText({
    requiredMessage: "请填写接管责任人后再生成接管草稿",
    typeMessage: "接管责任人编号必须是文字",
    blankMessage: "请填写接管责任人后再生成接管草稿"
  })
  responsibleUserId!: string;

  @IsRequiredText({
    requiredMessage: "请填写批次复核意见后再生成接管草稿",
    typeMessage: "批次复核意见必须是文字",
    blankMessage: "请填写批次复核意见后再生成接管草稿"
  })
  reviewComment!: string;

  @IsRequiredText({
    requiredMessage: "请填写批次验收结论后再生成接管草稿",
    typeMessage: "批次验收结论必须是文字",
    blankMessage: "请填写批次验收结论后再生成接管草稿"
  })
  acceptanceConclusion!: string;
}
