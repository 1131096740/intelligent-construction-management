import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText
} from "../validation/static-field-validation";
import {
  SPOT_PROCUREMENT_PAYMENT_METHODS,
  type SpotProcurementPaymentMethod
} from "@jiangkong/shared-domain";

export class ActualPurchaseBatchLineDto {
  @IsString()
  materialName!: string;

  @IsOptional()
  @IsString()
  specification?: string | null;

  @IsOptional()
  @IsString()
  unit?: string | null;

  @IsOptional()
  @IsString()
  quantity?: string | null;

  @IsOptional()
  @IsString()
  unitPrice?: string | null;

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "实际行金额格式不正确",
    formatMessage: "实际行金额必须按分填写为 0 或更大的整数"
  })
  amountCents?: string | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}

export class CreateActualPurchaseBatchDto {
  @IsIn(["spot_material", "general"], { message: "实际采购批次类型不正确" })
  kind!: "spot_material" | "general";

  @IsString()
  procurementId!: string;

  @IsOptional()
  @IsString()
  procurementVersionId?: string | null;

  @IsOptional()
  @IsString()
  companyEntityId?: string | null;

  @IsString()
  supplierName!: string;

  @IsCanonicalMoneyText({
    typeMessage: "实际采购总金额格式不正确",
    formatMessage: "实际采购总金额必须按分填写为大于 0 的整数"
  })
  totalAmountCents!: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsString()
  idempotencyKey!: string;

  @IsArray({ message: "实际采购明细必须是数组" })
  @ArrayMinSize(1, { message: "请至少填写一条实际采购明细" })
  @ValidateNested({ each: true })
  @Type(() => ActualPurchaseBatchLineDto)
  lines!: ActualPurchaseBatchLineDto[];
}

export class UpdateActualPurchaseBatchDto {
  @IsString()
  supplierName!: string;

  @IsCanonicalMoneyText({
    typeMessage: "实际采购总金额格式不正确",
    formatMessage: "实际采购总金额必须按分填写为大于 0 的整数"
  })
  totalAmountCents!: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsArray({ message: "实际采购明细必须是数组" })
  @ArrayMinSize(1, { message: "请至少填写一条实际采购明细" })
  @ValidateNested({ each: true })
  @Type(() => ActualPurchaseBatchLineDto)
  lines!: ActualPurchaseBatchLineDto[];
}

export class ActualPurchaseBatchChannelDto {
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, { message: "收款渠道类型不正确" })
  channelType!: SpotProcurementPaymentMethod;

  @IsOptional()
  @IsString()
  accountName?: string | null;

  @IsOptional()
  @IsString()
  accountNumber?: string | null;

  @IsOptional()
  @IsString()
  bankName?: string | null;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsBoolean({ message: "是否主收款渠道必须是布尔值" })
  isPrimary!: boolean;
}

export class CreateBatchSpotPaymentDto {
  @IsCanonicalMoneyText({
    typeMessage: "本次付款申请金额格式不正确",
    formatMessage: "本次付款申请金额必须按分填写为大于 0 的整数"
  })
  requestedAmountCents!: string;

  @IsIn(["company_direct", "handler_reimbursement"], { message: "付款类型不正确" })
  paymentType!: "company_direct" | "handler_reimbursement";

  @IsOptional()
  @IsString()
  payeeName?: string | null;

  @IsOptional()
  @IsString()
  payeeAccountName?: string | null;

  @IsOptional()
  @IsString()
  payeeBankName?: string | null;

  @IsOptional()
  @IsString()
  payeeBankAccount?: string | null;

  @IsOptional()
  @IsString()
  merchantPayeeMismatchNote?: string | null;

  @IsArray({ message: "拟付款方式必须是数组" })
  @ArrayMinSize(1, { message: "请至少选择一种拟付款方式" })
  @IsIn(SPOT_PROCUREMENT_PAYMENT_METHODS, { each: true, message: "拟付款方式不正确" })
  paymentMethods!: SpotProcurementPaymentMethod[];

  @IsArray({ message: "收款渠道必须是数组" })
  @ArrayMinSize(1, { message: "请至少填写一个收款渠道" })
  @ValidateNested({ each: true })
  @Type(() => ActualPurchaseBatchChannelDto)
  channels!: ActualPurchaseBatchChannelDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

export class RequestActualPurchaseBatchCorrectionDto {
  @IsCanonicalMoneyText({
    typeMessage: "更正后实际采购金额格式不正确",
    formatMessage: "更正后实际采购金额必须按分填写为大于 0 的整数"
  })
  correctedTotalAmountCents!: string;

  @IsString()
  reason!: string;

  @IsString()
  idempotencyKey!: string;
}

export class ConfirmActualPurchaseBatchCorrectionDto {
  @IsString()
  confirmationKey!: string;

  @IsOptional()
  @IsString()
  reviewNote?: string | null;

  @IsOptional()
  @IsString()
  selfReviewReason?: string | null;

  @IsOptional()
  @IsString()
  confirmationPassword?: string | null;
}

export class RecordActualPurchaseBatchRefundDto {
  @IsIn(["spot_procurement_payment_execution", "expense_claim_payment_execution"], {
    message: "退款关联的实付类型不正确"
  })
  executionType!: "spot_procurement_payment_execution" | "expense_claim_payment_execution";

  @IsString()
  executionId!: string;

  @IsCanonicalMoneyText({
    typeMessage: "退款金额格式不正确",
    formatMessage: "退款金额必须按分填写为大于 0 的整数"
  })
  amountCents!: string;

  @IsString()
  receivedAt!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  evidenceReference?: string | null;

  @IsString()
  idempotencyKey!: string;
}

export class CreateActualPurchaseBatchPaymentDto {
  @IsCanonicalMoneyText({
    typeMessage: "本次付款申请金额格式不正确",
    formatMessage: "本次付款申请金额必须按分填写为大于 0 的整数"
  })
  requestedAmountCents!: string;

  @IsString()
  idempotencyKey!: string;
}

export { IsOptionalNonBlankText };
