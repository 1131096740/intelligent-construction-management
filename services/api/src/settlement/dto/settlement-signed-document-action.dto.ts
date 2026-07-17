import { IsBoolean, IsInt, IsString, MaxLength, Min } from "class-validator";

export class GenerateSettlementFrozenDocumentDto {
  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision!: number;
}

export class RegenerateSettlementSignedDocumentDto {
  @IsBoolean()
  confirmPureRenderingIssue!: boolean;

  @IsString()
  @MaxLength(300)
  reason!: string;

  @IsString()
  @MaxLength(200)
  confirmationPassword!: string;
}
