import { randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;

/** Public HTTP only; real JWT/permission/retirement guards, synthetic persistence. */
export async function createTask09Draft(server: Server, amountLimitType: "capped" | "unlimited" = "capped", contractTypeKey: "material_purchase" | "equipment_rental" | "labor_subcontract" | "professional_subcontract" | "other" = "material_purchase") {
  const projectId = randomUUID();
  await server.store.prisma.project.create({ data: { id: projectId, code: "T09-NEW", name: "新建手选模板合成项目", isActive: true } });
  const token = await loginTemplateActor(server, "staff");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-contract-numeric-protocol": "2" };
  const response = await fetch(`${await server.app.getUrl()}/contracts`, { method: "POST", headers, body: JSON.stringify({ projectId, numericProtocolVersion: 2, contractTypeKey, relationship: "upward", amountLimitType }) });
  const created = await response.json() as { contract: { id: string }; version: { id: string } };
  expect({ status: response.status, created }).toMatchObject({ status: 201, created: { version: { signingSubjectType: "draft_unconfirmed", amountYuan: null, businessTemplateVersionId: null } } });
  const base = `${await server.app.getUrl()}/contract-drafts/${created.version.id}`;
  const lease = await fetch(`${base}/edit-lease`, { method: "POST", headers }).then(response => response.json()) as { token: string };
  return { ...created, projectId, headers, base, leaseToken: lease.token };
}

export async function saveTask09Draft(_server: Server, draft: Awaited<ReturnType<typeof createTask09Draft>>, businessType: string | undefined, layoutId?: string) {
  const workbench = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as { version: { draftRevision: number }; bills: Array<{ billKey: string; revision: number }> };
  return fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
    idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: workbench.version.draftRevision, changedSections: ["draft", "parties"],
    draft: { numericProtocolVersion: 2, draftData: { contractName: "上游新建当前合同名称", contractBasics: { businessType, relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", ...(layoutId === undefined ? {} : { layoutTemplateVersionId: layoutId }), taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
    parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
    bills: workbench.bills.map(bill => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  }) });
}
