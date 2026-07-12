import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { PreviewRoleRemovalDto } from "./preview-role-removal.dto";

export class PreviewRoleRemovalBatchDto {
  @IsArray({ message: "批量撤销目标必须是数组" })
  @ArrayMinSize(2, { message: "批量撤销至少需要 2 个目标" })
  @ArrayMaxSize(20, { message: "批量撤销一次最多 20 个目标" })
  @ValidateNested({ each: true })
  @Type(() => PreviewRoleRemovalDto)
  targets!: PreviewRoleRemovalDto[];
}
