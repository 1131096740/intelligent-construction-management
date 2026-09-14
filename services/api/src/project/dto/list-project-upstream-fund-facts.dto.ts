import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class ListProjectUpstreamFundFactsDto {
  @IsOptional()
  @IsString({ message: "上游资金明细游标必须是字符串" })
  @MaxLength(2_048, { message: "上游资金明细游标长度无效" })
  cursor?: string;

  @IsOptional()
  @IsString({ message: "上游资金明细每页条数必须是字符串" })
  @MaxLength(256, { message: "上游资金明细每页条数不能超过 256 个字符" })
  @Matches(/^(?:[1-9]|[1-9]\d|1\d\d|200)$/, {
    message: "上游资金明细每页条数必须是 1 到 200 的十进制整数"
  })
  pageSize?: string;
}
