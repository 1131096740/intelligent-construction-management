import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf
} from "class-validator";

export class RecordProjectUpstreamSettlementDto {
  @IsDateString({ strict: true }, { message: "对上结算日期格式不正确" })
  settledAt!: string;

  @IsString({ message: "报送金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "报送金额必须按分填写为 0 或更大的整数" })
  reportedAmountCents!: string;

  @IsString({ message: "审定金额格式不正确" })
  @Matches(/^(0|[1-9]\d*)$/, { message: "审定金额必须按分填写为 0 或更大的整数" })
  approvedAmountCents!: string;

  @IsString({ message: "审定方名称必须是文字" })
  @IsNotEmpty({ message: "审定方名称不能为空" })
  @Matches(/\S/u, { message: "审定方名称不能为空白" })
  approvingPartyName!: string;

  @IsString({ message: "结算期间必须是文字" })
  @IsNotEmpty({ message: "结算期间不能为空" })
  @Matches(/\S/u, { message: "结算期间不能为空白" })
  periodLabel!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "最终结算标记必须是布尔值" })
  isFinal?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "对上结算说明必须是文字" })
  description?: string;

  @IsString({ message: "对上结算凭证编号必须是文字" })
  @IsNotEmpty({ message: "对上结算凭证不能为空" })
  @Matches(/\S/u, { message: "对上结算凭证不能为空白" })
  voucherFileId!: string;

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}
