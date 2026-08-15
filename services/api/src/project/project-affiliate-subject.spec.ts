import { BadRequestException } from "@nestjs/common";
import {
  assertContractSigningSubject,
  resolveCurrentProjectAffiliate
} from "./project-affiliate-subject";

describe("project affiliate signing and payment subject invariants", () => {
  it("fails closed when a project has no explicit current affiliate mapping", async () => {
    const tx = {
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };

    await expect(resolveCurrentProjectAffiliate(tx as never, "project-1")).rejects.toThrow(
      "项目尚未明确配置唯一施工企业"
    );
  });

  it("fails closed when conflicting current affiliate mappings are observed", async () => {
    const tx = {
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "assignment-1" },
          { id: "assignment-2" }
        ])
      }
    };

    await expect(resolveCurrentProjectAffiliate(tx as never, "project-1")).rejects.toThrow(
      "项目存在多个当前施工企业"
    );
  });

  it("returns only the explicitly frozen current affiliate snapshot", async () => {
    const tx = {
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "assignment-1",
            projectId: "project-1",
            businessPartyId: "party-1",
            businessPartyVersionId: "party-version-3",
            affiliateNameSnapshot: "挂靠建设集团",
            affiliateCreditCodeSnapshot: "91310000AFFILIATE",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
            endedAt: null
          }
        ])
      }
    };

    await expect(resolveCurrentProjectAffiliate(tx as never, "project-1")).resolves.toEqual({
      assignmentId: "assignment-1",
      businessPartyId: "party-1",
      businessPartyVersionId: "party-version-3",
      name: "挂靠建设集团",
      unifiedSocialCreditCode: "91310000AFFILIATE"
    });
  });

  it.each([
    ["affiliate", "our_company"],
    ["our_company", "affiliate"]
  ] as const)(
    "rejects using a %s contract through the %s payment path",
    async (actual, expected) => {
      const tx = {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "version-1",
            signingSubjectType: actual
          })
        }
      };

      await expect(
        assertContractSigningSubject(tx as never, "version-1", expected)
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  );
});
