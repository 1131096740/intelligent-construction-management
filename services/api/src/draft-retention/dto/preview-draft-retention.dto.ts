import { IsIn } from "class-validator";

export class PreviewDraftRetentionDto {
  @IsIn(["preview", "execute"], { message: "技术清理模式只能是 preview 或 execute" })
  mode!: "preview" | "execute";
}
