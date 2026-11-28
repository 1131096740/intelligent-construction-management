import { IsDateString, IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";

export class RecordProjectOwnerSettlementDto {
  @IsString({ message: "业主名称必须是文字" })
  @IsNotEmpty({ message: "请填写业主名称" })
  @MaxLength(200, { message: "业主名称最多 200 字" })
  ownerName!: string;

  @IsDateString({ strict: true }, { message: "业主结算日期格式不正确" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "请选择业主结算日期" })
  settledAt!: string;

  @Matches(/^-?(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,4})?$/, {
    message: "业主结算金额须为有效金额，最多四位小数"
  })
  amountYuan!: string;

  @IsString({ message: "凭证格式不正确" })
  @IsNotEmpty({ message: "请上传业主结算凭证" })
  voucherFileId!: string;

  @IsString({ message: "登记请求格式不正确，请刷新后重试" })
  @IsNotEmpty({ message: "登记请求缺少编号，请刷新后重试" })
  @MaxLength(128, { message: "登记请求编号过长，请刷新后重试" })
  idempotencyKey!: string;
}
