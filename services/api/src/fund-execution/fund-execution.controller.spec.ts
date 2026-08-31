import "reflect-metadata";

import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { FundExecutionController } from "./fund-execution.controller";

describe("FundExecutionController authorization wiring", () => {
  function handler(method: keyof FundExecutionController) {
    return FundExecutionController.prototype[method] as object;
  }

  it("is never public", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FundExecutionController)).toBeFalsy();
  });

  it.each(["list", "detail", "returnCase", "review"] as const)(
    "does not preempt exact service-side direct/delegated authorization for %s",
    (method) => {
      expect(
        Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler(method))
      ).toBeUndefined();
    }
  );

  it("retains the direct global finance-director gate for final confirmation", () => {
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler("confirm"))
    ).toEqual(["finance_director"]);
  });

  it("retains finance writer gates on commands that do not accept approval delegation", () => {
    for (const method of [
      "capabilities",
      "create",
      "update",
      "submit",
      "reverse"
    ] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler(method))
      ).toEqual(["finance_staff", "finance_director"]);
    }
  });
});
