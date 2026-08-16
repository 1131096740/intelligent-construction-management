import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsString, Min } from "class-validator";

export class BusinessEntryExcelPreviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  definitionVersion!: number;

  @IsString()
  @IsNotEmpty()
  targetEntityType!: string;

  @IsString()
  @IsNotEmpty()
  targetEntityId!: string;
}
