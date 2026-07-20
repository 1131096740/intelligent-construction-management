import { IsISO8601 } from "class-validator";

export class CopySettlementDraftDto {
  @IsISO8601({}, { message: "来源结算草稿更新时间格式不正确" })
  expectedUpdatedAt!: string;
}
