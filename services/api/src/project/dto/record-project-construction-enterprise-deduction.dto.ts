import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

/**
 * #414 / OPS-08：施工企业扣费简单登记。
 *
 * 只要求费用名称、实际金额和发生日期；已有书面依据可附。
 * 扣费事实复用 ProjectUpstreamFundFact（factType=affiliate_deduction），
 * 由既有确认链路确认后才进入施工企业持有资金口径，不影响施工企业已付。
 */
export class RecordProjectConstructionEnterpriseDeductionDto {
  @IsRequiredText({
    requiredMessage: "请填写费用名称",
    typeMessage: "费用名称必须是文字",
    blankMessage: "请填写费用名称"
  })
  feeName!: string;

  @IsCanonicalMoneyText({
    typeMessage: "扣费金额格式不正确",
    formatMessage: "扣费金额必须按分填写为大于零的整数"
  })
  amountCents!: string;

  @IsDateString({ strict: true }, { message: "扣费发生日期格式不正确" })
  occurredAt!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID("4", { message: "扣费依据文件编号格式不正确" })
  evidenceFileId?: string;

  @IsUUID("4", { message: "扣费登记幂等键必须是 UUID" })
  idempotencyKey!: string;
}

export class ListProjectConstructionEnterpriseDeductionsDto {
  @IsOptional()
  @IsString({ message: "扣费明细游标必须是文字" })
  @MaxLength(2_048, { message: "扣费明细游标长度无效" })
  cursor?: string;

  @IsOptional()
  @IsString({ message: "扣费明细每页条数必须是文字" })
  @MaxLength(256, { message: "扣费明细每页条数不能超过 256 个字符" })
  @Matches(/^(?:[1-9]|[1-9]\d|1\d\d|200)$/, {
    message: "扣费明细每页条数必须是 1 到 200 的十进制整数"
  })
  pageSize?: string;
}
