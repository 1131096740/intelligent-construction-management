import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ContractDocumentController } from "./contract-document.controller";

describe("ContractDocumentController project guard", () => {
  it.each([
    "queue",
    "uploadOfflineRevision",
    "openNegotiationRound",
    "closeNegotiationRound",
    "disposeDifference",
    "retryOfflineRevision",
    "createOfflineRevisionPreviewDownloadTicket",
    "retry"
  ])("requires contract.create for %s", (handler) => {
    expect(Reflect.getMetadata(
      REQUIRED_PROJECT_ACTION_KEY,
      ContractDocumentController.prototype[handler as keyof ContractDocumentController]
    )).toBe("contract.create");
  });
});
