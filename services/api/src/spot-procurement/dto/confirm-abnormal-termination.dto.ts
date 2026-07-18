import { Equals, IsBoolean } from "class-validator";

export class ConfirmAbnormalTerminationDto {
  @IsBoolean({
    message: "异常终止确认值必须是布尔值"
  })
  @Equals(true, {
    message: "请明确确认异常终止本次零星采购"
  })
  confirmTermination!: boolean;
}
