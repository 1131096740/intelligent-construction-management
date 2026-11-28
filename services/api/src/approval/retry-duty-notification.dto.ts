import { Matches } from "class-validator";

export class RetryDutyNotificationDto {
  @Matches(/^[0-9a-f]{64}$/u, { message: "短信记录已变化，请刷新" })
  attemptId!: string;
}
