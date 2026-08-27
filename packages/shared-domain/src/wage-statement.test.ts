import { describe, expect, it } from "vitest";
import {
  WAGE_CREDITOR_SUBJECT_TYPES,
  WAGE_PAYABLE_REF_DIRECTIONS
} from "./wage-statement";

describe("wage statement shared contracts", () => {
  it("exposes the two frozen creditor identity alternatives without inventing institution catalogs", () => {
    expect(WAGE_CREDITOR_SUBJECT_TYPES).toEqual(["employee_user", "business_party"]);
  });

  it("keeps payable-reference directions explicit for append-only corrections", () => {
    expect(WAGE_PAYABLE_REF_DIRECTIONS).toEqual(["increase", "decrease"]);
  });
});
