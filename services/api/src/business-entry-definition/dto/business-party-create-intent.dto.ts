import { IsNotEmpty, IsString, IsUUID, Matches } from "class-validator";

export class BusinessPartyCreateIntentDto {
  @IsUUID("4")
  idempotencyKey!: string;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/iu)
  fingerprint!: string;
}

export class BusinessPartySubmissionIntentDto extends BusinessPartyCreateIntentDto {
  @IsString()
  @IsNotEmpty()
  probe!: string;
}
