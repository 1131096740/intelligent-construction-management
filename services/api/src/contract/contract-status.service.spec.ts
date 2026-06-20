import { ContractStatusService } from "./contract-status.service";

describe("ContractStatusService", () => {
  const service = new ContractStatusService();

  it("allows archive confirmation to make a contract version effective", () => {
    expect(service.canTransition("pending_archive_confirm", "effective")).toBe(true);
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
