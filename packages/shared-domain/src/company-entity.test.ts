import { describe, expect, it } from "vitest";
import {
  COMPANY_ENTITY_DATA_STATUSES,
  COMPANY_ENTITY_MAINTAINER_ROLES,
  COMPANY_ENTITY_READER_ROLES
} from "./company-entity";

describe("company entity domain constants", () => {
  it("keeps company entity maintainers in the confirmed business order", () => {
    expect(COMPANY_ENTITY_MAINTAINER_ROLES).toEqual([
      "comprehensive_director",
      "contract_staff",
      "contract_director"
    ]);
  });

  it("keeps company entity readers in the confirmed business order", () => {
    expect(COMPANY_ENTITY_READER_ROLES).toEqual([
      "comprehensive_director",
      "contract_staff",
      "contract_director",
      "finance_staff",
      "finance_director",
      "chairman",
      "general_manager"
    ]);
  });

  it("distinguishes complete data from legacy incomplete data", () => {
    expect(COMPANY_ENTITY_DATA_STATUSES).toEqual(["complete", "legacy_incomplete"]);
  });
});
