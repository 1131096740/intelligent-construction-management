import { describe, expect, it } from "vitest";
import { clearSelectedFileInput } from "./file-input-reset.config";

describe("file input reset helper", () => {
  it("clears both selected file state and native input value", () => {
    const selection = { value: new File(["voucher"], "付款凭证.pdf") as File | null };
    const input = { value: "C:\\fakepath\\付款凭证.pdf" };

    clearSelectedFileInput(selection, input);

    expect(selection.value).toBeNull();
    expect(input.value).toBe("");
  });

  it("clears selected file state even when input ref is unavailable", () => {
    const selection = { value: new File(["archive"], "归档.pdf") as File | null };

    clearSelectedFileInput(selection, null);

    expect(selection.value).toBeNull();
  });
});
