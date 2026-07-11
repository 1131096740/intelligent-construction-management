import { registerDecorator } from "class-validator";

type StaticTextValidator = (value: unknown) => boolean;

function StaticTextRule(
  name: string,
  message: string,
  validate: StaticTextValidator
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name,
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message },
      validator: { validate }
    });
  };
}

function passesRequiredText(value: unknown) {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value !== "string" || value.trim().length > 0)
  );
}

function passesTextType(value: unknown) {
  return value === null || value === undefined || typeof value === "string";
}

function passesDownloadReasonLength(value: unknown) {
  return (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Array.from(value).length <= 200
  );
}

export class CreateDownloadTicketDto {
  @StaticTextRule("confirmationPasswordRequired", "请输入当前登录密码", passesRequiredText)
  @StaticTextRule("confirmationPasswordType", "当前登录密码必须是文字", passesTextType)
  confirmationPassword!: string;

  @StaticTextRule("downloadReasonRequired", "请填写下载原因", passesRequiredText)
  @StaticTextRule("downloadReasonType", "下载原因必须是文字", passesTextType)
  @StaticTextRule(
    "downloadReasonMaxLength",
    "下载原因不能超过 200 个字",
    passesDownloadReasonLength
  )
  downloadReason!: string;
}
