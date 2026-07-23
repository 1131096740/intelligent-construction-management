import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsIntegerInRange,
  IsOptionalNonBlankText,
  IsRequiredText,
  IsStrictDateOnly
} from "../../validation/static-field-validation";

export class ExpenseClaimLineDto {
  @IsRequiredText({ requiredMessage: "费用类别不能为空", typeMessage: "费用类别必须是文字", blankMessage: "费用类别不能为空白" })
  expenseCategory!: string;

  @IsRequiredText({ requiredMessage: "发生日期不能为空", typeMessage: "发生日期必须是文字", blankMessage: "发生日期不能为空白" })
  @IsStrictDateOnly({ message: "发生日期必须为 YYYY-MM-DD 格式的有效日期" })
  occurredOn!: string;

  @IsRequiredText({ requiredMessage: "用途说明不能为空", typeMessage: "用途说明必须是文字", blankMessage: "用途说明不能为空白" })
  purpose!: string;

  @IsIntegerInRange({ min: 0, max: 10000, typeMessage: "单据张数必须是整数", rangeMessage: "单据张数必须在 0 到 10000 之间" })
  receiptCount!: number;

  @IsCanonicalMoneyText({ typeMessage: "费用金额必须是文字", formatMessage: "费用金额必须按分填写为大于 0 的整数" })
  amountCents!: string;

  @IsIn(["invoice", "receipt_or_other", "none"], { message: "证据类型不正确" })
  evidenceType!: "invoice" | "receipt_or_other" | "none";

  @ValidateIf((row: ExpenseClaimLineDto) => row.evidenceType === "none")
  @IsRequiredText({ requiredMessage: "无凭证原因必填", typeMessage: "无凭证原因必须是文字", blankMessage: "无凭证原因不能为空白" })
  noEvidenceReason?: string;

  @IsOptionalNonBlankText({ typeMessage: "备注必须是文字", blankMessage: "备注不能为空白" })
  remark?: string;
}

export class CreateExpenseClaimDto {
  @IsIn(["reimbursement", "loan"], { message: "费用业务类型不正确" })
  claimType!: "reimbursement" | "loan";

  @IsRequiredText({ requiredMessage: "使用单位不能为空", typeMessage: "使用单位必须是文字", blankMessage: "使用单位不能为空白" })
  companyEntityId!: string;

  @IsOptionalNonBlankText({ typeMessage: "项目编号必须是文字", blankMessage: "项目编号不能为空白" })
  projectId?: string;

  @ValidateIf((input: CreateExpenseClaimDto) => !input.projectId)
  @IsOptionalNonBlankText({ typeMessage: "事实证明人编号必须是文字", blankMessage: "非项目报销必须选择事实证明人" })
  factWitnessUserId?: string;

  @IsOptionalNonBlankText({ typeMessage: "报销人或借款人编号必须是文字", blankMessage: "报销人或借款人编号不能为空白" })
  applicantUserId?: string;

  @ValidateIf((input: CreateExpenseClaimDto) => !input.applicantUserId)
  @IsOptionalNonBlankText({ typeMessage: "无账号人员姓名必须是文字", blankMessage: "无账号人员姓名不能为空白" })
  applicantName?: string;

  @ValidateIf((input: CreateExpenseClaimDto) => !input.applicantUserId)
  @IsOptionalNonBlankText({ typeMessage: "无账号人员电话必须是文字", blankMessage: "无账号人员电话不能为空白" })
  applicantPhone?: string;

  @IsRequiredText({ requiredMessage: "事由不能为空", typeMessage: "事由必须是文字", blankMessage: "事由不能为空白" })
  reason!: string;

  @IsCanonicalMoneyText({ typeMessage: "申请金额必须是文字", formatMessage: "申请金额必须按分填写为大于 0 的整数" })
  requestedAmountCents!: string;

  @IsOptionalNonBlankText({ typeMessage: "收款方式必须是文字", blankMessage: "收款方式不能为空白" })
  paymentMethod?: string;

  @IsOptionalNonBlankText({ typeMessage: "收款对象必须是文字", blankMessage: "收款对象不能为空白" })
  payeeName?: string;

  @IsOptionalNonBlankText({ typeMessage: "收款账户名称必须是文字", blankMessage: "收款账户名称不能为空白" })
  payeeAccountName?: string;

  @IsOptionalNonBlankText({ typeMessage: "开户银行必须是文字", blankMessage: "开户银行不能为空白" })
  payeeBankName?: string;

  @IsOptionalNonBlankText({ typeMessage: "收款账号必须是文字", blankMessage: "收款账号不能为空白" })
  payeeBankAccount?: string;

  @IsOptionalNonBlankText({ typeMessage: "预计清账日期必须是文字", blankMessage: "预计清账日期不能为空白" })
  @IsStrictDateOnly({ message: "预计清账日期必须为 YYYY-MM-DD 格式的有效日期" })
  loanExpectedClearanceOn?: string;

  @ValidateIf((input: CreateExpenseClaimDto) => input.claimType === "reimbursement")
  @IsArray({ message: "费用明细必须是数组" })
  @ArrayMinSize(1, { message: "报销至少需要一条费用明细" })
  @ArrayMaxSize(200, { message: "单张报销最多 200 条费用明细" })
  @ValidateNested({ each: true, message: "每条费用明细必须是对象" })
  @Type(() => ExpenseClaimLineDto)
  lines?: ExpenseClaimLineDto[];
}
