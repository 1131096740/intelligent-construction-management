import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested
} from "class-validator";
import {
  HISTORY_EXPENSE_PAYMENT_STATUSES,
  HISTORY_EXPENSE_REVIEW_OUTCOMES
} from "../history-expense.domain";

export class HistoryExpenseRowDto {
  @IsObject({ message: "历史费用行必须是业务字段对象" })
  values!: Record<string, unknown>;
}

export class PrecheckHistoryExpenseDto {
  @IsArray({ message: "历史费用行必须是数组" })
  @ValidateNested({ each: true })
  @Type(() => HistoryExpenseRowDto)
  rows!: HistoryExpenseRowDto[];
}

export class CreateHistoryExpenseBatchDto extends PrecheckHistoryExpenseDto {
  @IsOptional()
  @IsString()
  batchNo?: string;

  @IsOptional()
  @IsUUID("4", { message: "来源文件编号必须是 UUID" })
  sourceFileId?: string;
}

export class VerifyHistoryExpenseRowDto {
  @IsInt({ message: "行版本必须是整数" })
  @Min(1, { message: "行版本无效，请刷新后重试" })
  expectedRevision!: number;

  @IsIn(HISTORY_EXPENSE_REVIEW_OUTCOMES, { message: "核实结论不正确" })
  reviewOutcome!: (typeof HISTORY_EXPENSE_REVIEW_OUTCOMES)[number];

  @IsOptional()
  @IsObject({ message: "历史费用行必须是业务字段对象" })
  values?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CorrectHistoryExpenseRowDto {
  @IsInt({ message: "行版本必须是整数" })
  @Min(1, { message: "行版本无效，请刷新后重试" })
  expectedRevision!: number;

  @IsString({ message: "请填写更正原因" })
  reason!: string;

  @IsObject({ message: "更正后的历史费用行必须是业务字段对象" })
  values!: Record<string, unknown>;
}

export class ConfirmHistoryExpenseDto {
  @IsInt({ message: "批次版本必须是整数" })
  @Min(1, { message: "批次版本无效，请刷新后重试" })
  expectedRevision!: number;

  @IsUUID("4", { message: "复核幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ActivateHistoryExpenseDto {
  @IsInt({ message: "批次版本必须是整数" })
  @Min(1, { message: "批次版本无效，请刷新后重试" })
  expectedRevision!: number;
}

export class HistoryExpenseRowQueryDto {
  @IsOptional()
  @IsIn(HISTORY_EXPENSE_PAYMENT_STATUSES as unknown as string[], {
    message: "付款状态筛选不正确"
  })
  paymentStatus?: string;
}
