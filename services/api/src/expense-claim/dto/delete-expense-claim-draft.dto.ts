import { IsISO8601 } from "class-validator";
export class DeleteExpenseClaimDraftDto {
  @IsISO8601({ strict: true }, { message: "草稿版本已失效，请刷新后重试" })
  expectedUpdatedAt!: string;
}
