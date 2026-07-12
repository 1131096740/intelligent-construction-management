import { ContractStatusService } from "./contract-status.service";

describe("ContractStatusService", () => {
  const service = new ContractStatusService();

  it("allows archive confirmation to make a contract version effective", () => {
    expect(service.canTransition("pending_archive_confirm", "effective")).toBe(true);
  });

  it("keeps a superseded version terminal so historical lineage remains stable", () => {
    expect(service.canTransition("superseded", "voided")).toBe(false);
    expect(() => service.assertTransition("superseded", "voided")).toThrow(
      "Invalid contract status transition: superseded -> voided"
    );
  });

  it("still allows the current effective version to be voided", () => {
    expect(service.canTransition("effective", "voided")).toBe(true);
  });

  it("does not allow approval to skip seal and archive", () => {
    expect(service.canTransition("approved_pending_seal", "effective")).toBe(false);
  });

  it("throws on invalid transitions", () => {
    expect(() => service.assertTransition("approved_pending_seal", "effective")).toThrow(
      "Invalid contract status transition: approved_pending_seal -> effective"
    );
  });
});
