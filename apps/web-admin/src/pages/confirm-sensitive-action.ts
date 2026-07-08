export function confirmSensitiveAction(
  message: string,
  confirmFn: ((message: string) => boolean) | undefined = globalThis.window?.confirm
) {
  return confirmFn ? confirmFn(message) : true;
}

export function promptSensitiveActionReason(
  message = "请输入下载原因",
  promptFn: ((message: string) => string | null) | undefined = globalThis.window?.prompt
): string | null {
  const reason = promptFn ? promptFn(message) : "业务下载";
  const trimmed = reason?.trim() ?? "";
  return trimmed ? trimmed : null;
}
