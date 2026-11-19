import { IsInt, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class ClaimInitialPublicCashCustodyDto {
  @IsUUID("4") idempotencyKey!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
}

export class StartPublicCashHandoverDto {
  @IsUUID("4") idempotencyKey!: string;
  @IsUUID("4") toCustodianId!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @IsString() @MaxLength(25) deliveredYuan!: string;
  @IsString() @MaxLength(1000) evidenceReference!: string;
}

export class ConfirmPublicCashHandoverDto {
  @IsUUID("4") idempotencyKey!: string;
  @IsString() @MaxLength(25) receivedYuan!: string;
}
