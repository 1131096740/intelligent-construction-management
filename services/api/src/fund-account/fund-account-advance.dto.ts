import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export const FUND_ADVANCE_CONTRIBUTOR_KINDS = ["company", "construction_enterprise", "person", "other", "unknown"] as const;
export type FundAdvanceContributorKind = (typeof FUND_ADVANCE_CONTRIBUTOR_KINDS)[number];

export class RegisterFundAccountAdvanceDto {
  @IsString({ message: "请选择公司资金或公共现金" })
  @MaxLength(200, { message: "账户选择异常，请刷新后重选" })
  scopeKey!: string;

  @IsString({ message: "请选择原确认登记" })
  @MaxLength(200, { message: "原登记选择异常，请刷新后重选" })
  expectedRegistrationId!: string;

  @IsString({ message: "提交凭据缺失，请保留原输入" })
  @Matches(/^\S+$/u, { message: "提交凭据异常，请保留输入后重试" })
  @MaxLength(100, { message: "提交凭据异常，请保留输入后重试" })
  idempotencyKey!: string;

  @IsIn(FUND_ADVANCE_CONTRIBUTOR_KINDS, { message: "请选择实际出资方类型" })
  contributorKind!: FundAdvanceContributorKind;

  @IsOptional()
  @IsString({ message: "请从列表选择实际出资方" })
  @MaxLength(200, { message: "出资方选择异常，请刷新后重选" })
  contributorId?: string | null;

  @IsOptional()
  @IsString({ message: "请填写实际出资方姓名或名称" })
  @MaxLength(200, { message: "出资方姓名请控制在二百字以内" })
  contributorName?: string | null;

  @IsOptional()
  @IsString({ message: "请从列表选择实际项目" })
  @MaxLength(200, { message: "项目选择异常，请刷新后重选" })
  projectId?: string | null;

  @IsString({ message: "到账金额请填写数字文本，最多保留四位小数" })
  amountYuan!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/u, { message: "请填写实际到账日期" })
  receivedOn!: string;

  @IsString({ message: "请填写实际到账核对依据" })
  @MaxLength(1000, { message: "核对依据请控制在一千字以内" })
  evidenceReference!: string;
}

export class RegisterCompanyOwnedFundReceiptDto {
  @IsString({ message: "请选择公司资金账户" })
  @MaxLength(200, { message: "账户选择异常，请刷新后重选" })
  scopeKey!: string;

  @IsString({ message: "请选择原确认登记" })
  @MaxLength(200, { message: "原登记选择异常，请刷新后重选" })
  expectedRegistrationId!: string;

  @IsString({ message: "提交凭据缺失，请保留原输入" })
  @Matches(/^\S+$/u, { message: "提交凭据异常，请保留输入后重试" })
  @MaxLength(100, { message: "提交凭据异常，请保留输入后重试" })
  idempotencyKey!: string;

  @IsString({ message: "请选择已核验银行入账" })
  @MaxLength(200, { message: "银行流水选择异常，请刷新后重选" })
  observationReference!: string;

  @IsString({ message: "请填写公司自有本金的核对依据" })
  @MaxLength(1000, { message: "本金权属核对依据请控制在一千字以内" })
  ownershipEvidence!: string;
}


export class CompanyOwnedFundOptionsDto {
  @IsString({ message: "请选择公司资金账户" })
  @IsNotEmpty({ message: "请选择公司资金账户" })
  @MaxLength(200, { message: "公司选择异常，请刷新后重选" })
  companyId!: string;
}
