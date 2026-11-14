import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildTask12GeneratedApprovalFixture } from "./task12-generated-approval-admission";

const fixtures = new WeakSet<object>();
function coordinate(caseId: string, key: string) {
  const raw = createHash("sha256").update("task12-local-lifecycle/" + caseId + "/" + key).digest("hex");
  return [raw.slice(0, 8), raw.slice(8, 12), "4" + raw.slice(13, 16), "a" + raw.slice(17, 20), raw.slice(20, 32)].join("-");
}

/** Fixed master data only. No contract, approval, file or archive is seeded. */
export function buildTask12LocalLifecycleFixture(caseId: string) {
  const approval = buildTask12GeneratedApprovalFixture(caseId);
  const id = (key: string) => coordinate(caseId, key);
  const company = Object.freeze({ id: id("company"), name: "隔离验收我方公司", unifiedSocialCreditCode: "91440300708461136T",
    registeredAddress: "隔离测试地址", dataStatus: "complete", currentVersionNo: 1, isActive: true });
  const companyVersion = Object.freeze({ id: id("company-version"), companyEntityId: company.id, versionNo: 1, name: company.name,
    unifiedSocialCreditCode: company.unifiedSocialCreditCode, registeredAddress: company.registeredAddress, isActive: true, action: "create", actorUserId: approval.handler.id });
  const party = Object.freeze({ id: id("party"), type: "organization", name: "隔离验收供应单位", normalizedName: "隔离验收供应单位",
    unifiedSocialCreditCode: "91350211M000100Y46", status: "active", createdByUserId: approval.handler.id });
  const master = Object.freeze({
    CompanyEntity: Object.freeze([company]), CompanyEntityVersion: Object.freeze([companyVersion]),
    ProjectParticipatingCompany: Object.freeze([Object.freeze({ id: id("participating-company"), projectId: approval.project.id,
      companyEntityId: company.id, companyEntityVersionId: companyVersion.id, companyNameSnapshot: company.name,
      companyCreditCodeSnapshot: company.unifiedSocialCreditCode, effectiveFrom: "2026-01-01T00:00:00.000Z", endedAt: null,
      changeReason: "本轮隔离验收", addedByUserId: approval.handler.id })]),
    BusinessParty: Object.freeze([party]),
    BusinessPartyVersion: Object.freeze([Object.freeze({ id: id("party-version"), businessPartyId: party.id, versionNo: 1,
      createdByUserId: approval.handler.id, snapshot: Object.freeze({ name: party.name, type: party.type,
        unifiedSocialCreditCode: party.unifiedSocialCreditCode, registeredAddress: "隔离供应地址" }) })])
  });
  const fixture = Object.freeze({ approval, master }); fixtures.add(fixture); return fixture;
}
export function isTask12LocalLifecycleFixture(value: unknown): value is ReturnType<typeof buildTask12LocalLifecycleFixture> {
  return typeof value === "object" && value !== null && fixtures.has(value);
}


/** Local-only test evidence, never an assertion that real parties signed. */
export async function createTask12LocalLifecycleOriginals(fixture: ReturnType<typeof buildTask12LocalLifecycleFixture>) {
  if (!isTask12LocalLifecycleFixture(fixture)) throw new Error("本地验收数据来源无效");
  const originals: Buffer[] = [];
  for (const marker of ["Both parties signed original one", "Both parties signed original two"]) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText(marker, { x: 40, y: 700, font, size: 14 });
    originals.push(Buffer.from(await pdf.save()));
  }
  return Object.freeze(originals);
}
