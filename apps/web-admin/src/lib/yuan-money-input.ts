import { centsTextToYuanText, signedYuanTextToCentsText, yuanTextToCentsText } from "./money";

/** View state keeps unfinished typing separate from the cents-only API value. */
export function createYuanMoneyInput(initialCents: string, signed = false) {
  let lastEmitted: string | undefined;
  const field = {
    text: initialCents ? centsTextToYuanText(initialCents).replaceAll(",", "") : "",
    error: "",
    input(text: string): string {
      this.text = text;
      try {
        const cents = signed ? signedYuanTextToCentsText(text.trim()) : yuanTextToCentsText(text.trim());
        if (BigInt(cents) > 9_223_372_036_854_775_807n) {
          throw new Error("金额超出系统可保存范围");
        }
        this.error = "";
        lastEmitted = cents;
      } catch {
        this.error = "请填写元金额，最多两位小数，且不超过系统可保存范围";
        lastEmitted = "";
      }
      return lastEmitted;
    },
    receive(cents: string) {
      if (cents === lastEmitted) return;
      this.text = cents ? centsTextToYuanText(cents).replaceAll(",", "") : "";
      this.error = "";
      lastEmitted = undefined;
    }
  };
  return field;
}
