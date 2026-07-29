import { IsOptional, IsUUID } from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ConfirmContractTakeoverSideDto {
  @IsUUID("4", { message: "部门确认幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "部门确认修订必须是整数",
    rangeMessage: "部门确认修订必须大于 0"
  })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "部门确认必须填写当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "部门确认必须填写当前登录密码"
  })
  currentPassword!: string;

  @IsOptional()
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "财务确认依据的合同侧修订必须是整数",
    rangeMessage: "财务确认依据的合同侧修订必须大于 0"
  })
  basedOnContractRevision?: number;

  @IsOptional()
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "财务确认依据的财务基线修订必须是整数",
    rangeMessage: "财务确认依据的财务基线修订必须大于 0"
  })
  basedOnFinanceBasisRevision?: number;
}
