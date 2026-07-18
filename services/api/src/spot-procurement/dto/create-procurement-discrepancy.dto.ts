import { IsIn, IsOptional, MaxLength } from "class-validator";
import { IsOptionalNonBlankText } from "../../validation/static-field-validation";

export const PROCUREMENT_DISCREPANCY_RESOLUTION_TYPES = [
  "replenishment",
  "full_refund",
  // 仅为历史单据兼容保留；真实表单路径会在服务端固定拒绝。
  "full_supplier_balance"
] as const;

export type ProcurementDiscrepancyResolutionType =
  (typeof PROCUREMENT_DISCREPANCY_RESOLUTION_TYPES)[number];

export const PROCUREMENT_DISCREPANCY_OPERATIONS = [
  "initiate",
  "confirm"
] as const;

export type ProcurementDiscrepancyOperation =
  (typeof PROCUREMENT_DISCREPANCY_OPERATIONS)[number];

export class CreateProcurementDiscrepancyDto {
  @IsIn(PROCUREMENT_DISCREPANCY_OPERATIONS, {
    message: "差异处理操作不正确"
  })
  operation!: ProcurementDiscrepancyOperation;

  @IsOptional()
  @IsIn(PROCUREMENT_DISCREPANCY_RESOLUTION_TYPES, {
    message: "真实多付处理方式不正确"
  })
  resolutionType?: ProcurementDiscrepancyResolutionType;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "差异处理备注必须是文字",
    blankMessage: "差异处理备注不能为空白"
  })
  @MaxLength(500, { message: "差异处理备注不能超过 500 个字符" })
  note?: string;
}
