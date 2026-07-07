export function confirmSensitiveAction(
  message: string,
  confirmFn: ((message: string) => boolean) | undefined = globalThis.window?.confirm
) {
  return confirmFn ? confirmFn(message) : true;
}
