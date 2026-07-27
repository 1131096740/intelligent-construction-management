import { Type } from "class-transformer";
import { IsBoolean, ValidateIf, ValidateNested } from "class-validator";
import { IsOptionalArray } from "../../validation/static-field-validation";
import { CreateSettlementLineDto } from "./create-settlement.dto";

export class PreviewSettlementLinesDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "是否最终结算必须是布尔值" })
  isFinal?: boolean;

  @IsOptionalArray({ typeMessage: "结算明细必须是数组" })
  @ValidateNested({ each: true, message: "每条结算明细必须是对象" })
  @Type(() => CreateSettlementLineDto)
  settlementLines?: CreateSettlementLineDto[];
}
