import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsString, MaxLength, ValidateIf, ValidateNested } from "class-validator";
import { IsCanonicalMoneyText, IsRequiredText } from "../../validation/static-field-validation";
import { ExpenseClaimLineDto } from "./create-expense-claim.dto";

export class WithdrawExpenseClaimDto {
  @IsRequiredText({ requiredMessage: "请提供当前审批轮次", typeMessage: "审批轮次格式不正确", blankMessage: "审批轮次不能为空白" })
  @MaxLength(64, { message: "审批轮次格式不正确" })
  approvalInstanceId!: string;
}

export class EditReturnedExpenseClaimDto {
  @IsISO8601({ strict: true }, { message: "草稿版本已失效，请刷新后重试" })
  expectedUpdatedAt!: string;

  @IsRequiredText({ requiredMessage: "事由不能为空", typeMessage: "事由必须是文字", blankMessage: "事由不能为空白" })
  reason!: string;

  @ValidateIf((_input, value) => value !== undefined && value !== null)
  @IsString({ message: "请选择项目成本承担公司或待归属" })
  @MaxLength(100)
  costBearingCompanyEntityId?: string | null;

  @ValidateIf((_input, value) => value !== undefined)
  @IsCanonicalMoneyText({ typeMessage: "申请金额必须是文字", formatMessage: "申请金额必须按分填写为大于 0 的整数" })
  requestedAmountCents?: string;

  @ValidateIf((_input, value) => value !== undefined)
  @IsArray({ message: "费用明细必须是数组" })
  @ArrayMinSize(1, { message: "报销至少需要一条费用明细" })
  @ArrayMaxSize(200, { message: "单张报销最多 200 条费用明细" })
  @ValidateNested({ each: true, message: "每条费用明细必须是对象" })
  @Type(() => ExpenseClaimLineDto)
  lines?: ExpenseClaimLineDto[];
}
