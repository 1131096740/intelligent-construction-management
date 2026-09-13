import { IsOptional, IsString, MaxLength } from "class-validator";

export class ListProjectUpstreamFundFactsDto {
  @IsOptional()
  @IsString({ message: "上游资金明细游标必须是字符串" })
  @MaxLength(2_048, { message: "上游资金明细游标长度无效" })
  cursor?: string;

  @IsOptional()
  @IsString({ message: "上游资金明细每页条数必须是字符串" })
  pageSize?: string;
}
