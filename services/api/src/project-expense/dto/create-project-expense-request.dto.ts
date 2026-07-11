import { IsIn, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class CreateProjectExpenseRequestDto {
  @IsString({ message: "申请单号必须是文字" })
  @IsNotEmpty({ message: "申请单号不能为空" })
  @Matches(/\S/u, { message: "申请单号不能为空白" })
  code!: string;

  @IsIn(
    ["sporadic_payment", "loan_reserve", "comprehensive_expense", "reimbursement", "spot_purchase"],
    { message: "费用类型不正确" }
  )
  expenseType!:
    | "sporadic_payment"
    | "loan_reserve"
    | "comprehensive_expense"
    | "reimbursement"
    | "spot_purchase";

  @IsIn(
    [
      "sporadic_material",
      "sporadic_machinery",
      "sporadic_labor",
      "temporary_service",
      "other_sporadic",
      "employee_loan",
      "owner_loan",
      "project_reserve",
      "travel",
      "entertainment",
      "reimbursement",
      "spot_material_purchase",
      "spot_tool_purchase",
      "spot_service_purchase",
      "spot_other_purchase"
    ],
    { message: "费用子类不正确" }
  )
  expenseSubtype!:
    | "sporadic_material"
    | "sporadic_machinery"
    | "sporadic_labor"
    | "temporary_service"
    | "other_sporadic"
    | "employee_loan"
    | "owner_loan"
    | "project_reserve"
    | "travel"
    | "entertainment"
    | "reimbursement"
    | "spot_material_purchase"
    | "spot_tool_purchase"
    | "spot_service_purchase"
    | "spot_other_purchase";

  @IsString({ message: "付款事项必须是文字" })
  @IsNotEmpty({ message: "付款事项不能为空" })
  @Matches(/\S/u, { message: "付款事项不能为空白" })
  paymentSubject!: string;

  @IsString({ message: "申请事由必须是文字" })
  @IsNotEmpty({ message: "申请事由不能为空" })
  @Matches(/\S/u, { message: "申请事由不能为空白" })
  reason!: string;

  @IsString({ message: "申请金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "申请金额必须按分填写为 0 或更大的整数" })
  requestedAmountCents!: string;

  @IsIn(["cash", "wechat", "alipay", "bank_transfer", "other"], {
    message: "付款方式不正确"
  })
  paymentMethod!: "cash" | "wechat" | "alipay" | "bank_transfer" | "other";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "收款方名称必须是文字" })
  counterpartyName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "账户名称必须是文字" })
  counterpartyAccountName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "开户银行必须是文字" })
  counterpartyBankName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "银行账号必须是文字" })
  counterpartyBankAccount?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经办人编号必须是文字" })
  @IsNotEmpty({ message: "经办人编号不能为空" })
  @Matches(/\S/u, { message: "经办人编号不能为空白" })
  handlerUserId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "附件编号必须是文字" })
  @IsNotEmpty({ message: "附件编号不能为空" })
  @Matches(/\S/u, { message: "附件编号不能为空白" })
  attachmentFileId?: string;
}
