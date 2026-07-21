import { IsIn } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export type ContractTakeoverEvidencePurpose =
  | "historical_contract_scan"
  | "historical_settlement_ledger"
  | "historical_payment_voucher"
  | "other";

export class AttachContractTakeoverEvidenceDto {
  @IsRequiredText({
    requiredMessage: "请先选择要挂接的接管资料文件",
    typeMessage: "接管资料文件编号必须是文字",
    blankMessage: "请先选择要挂接的接管资料文件"
  })
  fileId!: string;

  @IsIn(
    [
      "historical_contract_scan",
      "historical_settlement_ledger",
      "historical_payment_voucher",
      "other"
    ],
    { message: "接管资料类型不正确" }
  )
  purpose!: ContractTakeoverEvidencePurpose;
}

export class AttachHistoricalPaymentVoucherDto {
  @IsRequiredText({
    requiredMessage: "请先选择要挂接的历史付款凭证文件",
    typeMessage: "历史付款凭证文件编号必须是文字",
    blankMessage: "请先选择要挂接的历史付款凭证文件"
  })
  fileId!: string;
}
