import { IsIn } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

/**
 * #405 PAY-17：其他项目付款登记。只填项目/用途/类别/收款对象/金额，
 * 不要求也不允许补造合同或结算；审批、实付、成本仍由费用领域负责。
 */
export class CreateOtherProjectPaymentDto {
  @IsRequiredText({ requiredMessage: "项目不能为空", typeMessage: "项目必须是文字", blankMessage: "项目不能为空白" })
  projectId!: string;

  @IsRequiredText({ requiredMessage: "用途不能为空", typeMessage: "用途必须是文字", blankMessage: "用途不能为空白" })
  reason!: string;

  @IsIn(["temporary_service", "temporary_machinery_shift", "sporadic_labor", "other_incidental"], {
    message: "其他项目付款类别不正确；材料类支出请走零星材料或综合采购流程"
  })
  incidentalExpenseCategory!: "temporary_service" | "temporary_machinery_shift" | "sporadic_labor" | "other_incidental";

  @IsRequiredText({ requiredMessage: "收款对象不能为空", typeMessage: "收款对象必须是文字", blankMessage: "收款对象不能为空白" })
  payeeName!: string;

  @IsCanonicalMoneyText({ typeMessage: "付款金额必须是文字", formatMessage: "付款金额必须按分填写为大于 0 的整数" })
  requestedAmountCents!: string;

  @IsRequiredText({ requiredMessage: "使用单位不能为空", typeMessage: "使用单位必须是文字", blankMessage: "使用单位不能为空白" })
  companyEntityId!: string;

  @IsOptionalNonBlankText({ typeMessage: "收款方式必须是文字", blankMessage: "收款方式不能为空白" })
  paymentMethod?: string;

  @IsOptionalNonBlankText({ typeMessage: "收款账户名称必须是文字", blankMessage: "收款账户名称不能为空白" })
  payeeAccountName?: string;

  @IsOptionalNonBlankText({ typeMessage: "开户银行必须是文字", blankMessage: "开户银行不能为空白" })
  payeeBankName?: string;

  @IsOptionalNonBlankText({ typeMessage: "收款账号必须是文字", blankMessage: "收款账号不能为空白" })
  payeeBankAccount?: string;
}
