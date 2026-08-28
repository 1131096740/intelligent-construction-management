import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("PayableRegistryController selection boundary", () => {
  it("exposes only the controlled candidate projection and opaque allocation command", () => {
    const controller = readFileSync(join(__dirname, "payable-registry.controller.ts"), "utf8");
    const dto = readFileSync(join(__dirname, "payable-registry.dto.ts"), "utf8");

    expect(controller).toContain(
      '@Get("wage-payable-cases/:payableRef/payment-execution-candidates")'
    );
    expect(controller).toContain(
      '@Post("wage-payable-cases/:payableRef/allocations")'
    );
    expect(controller).toContain('@Get("inter-entity-relationships")');
    expect(controller).toContain(
      '@Post("inter-entity-relationships/:relationshipEntryId/returns")'
    );
    expect(controller).toContain(
      '@Post("inter-entity-relationships/:relationshipEntryId/evidence")'
    );
    expect(controller).toContain("createInterEntityRelationshipEvidenceClaim");
    expect(dto).toContain("export class ReturnInterEntityRelationshipDto");
    expect(controller).not.toContain('@Post("drafts")');
    expect(controller).not.toContain("paymentExecutionId");
    expect(dto).not.toContain("paymentExecutionId");
    expect(dto).toContain("export class AllocatePaymentExecutionDto");
    expect(dto).toContain("selectionRef!: string");
    expect(dto).toContain("selectionExpiresAt!: string");
    expect(dto).toContain("expectedCaseRevision!: number");
    expect(dto).toContain("@IsUUID(\"4\"");
  });
});
