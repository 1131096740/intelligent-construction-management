import { IsISO8601 } from "class-validator";

export class CopyContractDraftDto {
  @IsISO8601({}, { message: "来源合同更新时间格式不正确" })
  expectedUpdatedAt!: string;
}
