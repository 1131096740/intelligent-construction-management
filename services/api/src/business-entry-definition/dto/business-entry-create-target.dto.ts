import { IsNotEmpty, IsString } from "class-validator";

export class BusinessEntryCreateTargetDto {
  @IsString()
  @IsNotEmpty()
  entityType!: string;
}
