import "reflect-metadata";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { ContractTemplateController } from "./contract-template.controller";

describe("ContractTemplateController authorization wiring", () => {
  const governancePositions = ["contract_director", "super_admin"];
  const governedMethods = [
    "createLayout",
    "inspectLayout",
    "queueLayoutPreview",
    "getLayoutPreview",
    "submitLayout",
    "publishLayout",
    "cloneLayout",
    "stopLayout",
    "revokeLayout",
    "getTemplate",
    "createTemplate",
    "updateDraftVersion",
    "cloneVersion",
    "submitVersion",
    "publishVersion",
    "stopVersion",
    "revokeVersion",
    "createClause",
    "submitClauseVersion",
    "publishClauseVersion"
  ];

  it.each(governedMethods)("guards %s with template governance positions", (method) => {
    const handler = (ContractTemplateController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler)).toEqual(governancePositions);
  });

  it("keeps published template and layout reads open to authenticated users", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractTemplateController.prototype.listPublished)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractTemplateController.prototype.listPublishedLayouts)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractTemplateController.prototype.listPublishedClauses)).toBeUndefined();
  });
});
