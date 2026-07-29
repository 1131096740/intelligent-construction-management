import { IsUUID } from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";

export class WithdrawContractTakeoverSideConfirmationDto {
  @IsUUID("4", { message: "部门确认撤回幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "部门确认撤回修订必须是整数",
    rangeMessage: "部门确认撤回修订必须大于 0"
  })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "部门确认撤回必须填写当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "部门确认撤回必须填写当前登录密码"
  })
  currentPassword!: string;

  @IsRequiredText({
    requiredMessage: "请填写部门确认撤回原因",
    typeMessage: "部门确认撤回原因必须是文字",
    blankMessage: "请填写部门确认撤回原因"
  })
  reason!: string;
}
