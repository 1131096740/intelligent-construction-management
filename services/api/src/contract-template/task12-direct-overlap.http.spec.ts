import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { openDirectPendingDraft } from "./task12-direct-pending.test-support";
import { seedDirectReviewDatabaseBinding } from "./task12-direct-review-persistence.oracle";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor, seedSelectionDraft } from "./template-selection.test-support";

it("履约复核清单以已签四位金额和真实相对方列出疑似重叠，不把未注明编号当成原号", async () => {
  const server = await createTemplateTestServer({ draftWorkbench: true, economicReviewReads: true });
  try {
    const draft = await openDirectPendingDraft(server);
    await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "staff", positionKey: "contract_staff" } });
    const enterpriseId = randomUUID(), enterpriseVersionId = randomUUID();
    const counterpartyId = randomUUID(), counterpartyVersionId = randomUUID();
    for (const [id, versionId, name] of [
      [enterpriseId, enterpriseVersionId, "施工企业"],
      [counterpartyId, counterpartyVersionId, "材料 相对方"]
    ]) {
      await server.store.prisma.businessParty.create({ data: { id, name, status: "active" } });
      await server.store.prisma.businessPartyVersion.create({ data: { id: versionId, businessPartyId: id, versionNo: 1, snapshot: { name, unifiedSocialCreditCode: "合成信用码" } } });
    }
    await server.store.prisma.projectAffiliateAssignment.create({ data: {
      id: randomUUID(), projectId: draft.projectId, businessPartyId: enterpriseId, businessPartyVersionId: enterpriseVersionId,
      affiliateNameSnapshot: "施工企业", affiliateCreditCodeSnapshot: "合成信用码", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), endedAt: null
    } });
    const list = async () => {
      const response = await fetch(draft.base + "/contract-economic-reviews?projectId=" + draft.projectId, { headers: draft.headers });
      expect(response.status).toBe(200);
      return await response.json();
    };
    expect(await list()).toMatchObject({ directCandidateSourceStatus: "incomplete", directCandidates: [] });
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iC3sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "签章原件.png");
    const upload = await fetch(draft.base + draft.path + "/files", { method: "POST", headers: { authorization: draft.headers.authorization }, body: form });
    expect(upload.status).toBe(201);
    const { id: fileId } = await upload.json() as { id: string };
    const saved = await draft.save({ ...draft.input, draft: {
      ...draft.input.draft, manualAmountYuan: "100.0000",
      draftData: { ...draft.input.draft.draftData, directSigningInput: { ...draft.created.version.draftData.directSigningInput,
        enterpriseParty: { roleKey: "party_a", displayOrder: 0 }, counterpartyParty: { roleKey: "party_b", displayOrder: 0 }
      } }
    }, parties: [
      { roleKey: "party_a", displayOrder: 0, businessPartyVersionId: enterpriseVersionId, snapshot: {} },
      { roleKey: "party_b", displayOrder: 0, businessPartyVersionId: counterpartyVersionId, snapshot: {} }
    ], attachments: [{ slotKey: "direct_signed_originals_v1", fileId, displayOrder: 0 }] });
    const savedBody = await saved.json();
    expect({ status: saved.status, body: savedBody }).toMatchObject({ status: 200, body: { directSigningInput: { state: "complete" } } });

    const near = await seedSelectionDraft(server, false, "正式合同");
    await server.store.prisma.contract.update({ where: { id: near.contractId }, data: { projectId: draft.projectId, counterparty: "材料·相对方", code: "正式编号" } });
    await server.store.prisma.contractVersion.update({ where: { id: near.versionId }, data: { status: "effective", effectiveAt: new Date(), amountYuan: new Prisma.Decimal("90.0000") } });
    const externalLedgerId = randomUUID();
    await server.store.prisma.projectAffiliateContractFact.create({ data: {
      id: randomUUID(), projectId: draft.projectId, ledgerId: externalLedgerId, entryKind: "original", status: "confirmed",
      externalContractReference: "未注明编号", description: "其他项目资料标题", counterpartyName: "材料相对方", amountCents: 8000n, documentVersion: 1
    } });
    const remote = await seedSelectionDraft(server, false, "签章原件合同");
    await server.store.prisma.contract.update({ where: { id: remote.contractId }, data: { counterparty: "材料相对方" } });

    const directRef = "contract:" + draft.created.contract.id;
    const formalRef = "contract:" + near.contractId;
    const initial = await list();
    expect(initial.directCandidateSourceStatus).toBe("complete");
    expect(initial.directCandidates).toHaveLength(1);
    expect([initial.directCandidates[0].leftSourceRef, initial.directCandidates[0].rightSourceRef].sort()).toEqual([directRef, formalRef].sort());
    expect(initial.documents.map((document: { ref: string }) => document.ref)).not.toContain(directRef);
    expect(initial.candidates).toEqual([]);
    await server.store.prisma.contractVersion.update({ where: { id: near.versionId }, data: { amountYuan: new Prisma.Decimal("89.9999") } });
    expect((await list()).directCandidates).toEqual([]);
    await server.store.prisma.projectAffiliateContractFact.updateMany({ where: { ledgerId: externalLedgerId }, data: { amountCents: 9000n } });
    const external = await list();
    expect(external.directCandidates).toHaveLength(1);
    expect([external.directCandidates[0].leftSourceRef, external.directCandidates[0].rightSourceRef].sort()).toEqual([directRef, "affiliate:" + externalLedgerId].sort());
    expect(await server.store.prisma.contractEconomicReview.count()).toBe(0);
    const pendingCatalog = server.store.table("directPendingBindingCatalog");
    const installed = await pendingCatalog.findFirst();
    if (!installed?.snapshot || typeof installed.snapshot !== "object") throw new Error("缺少合成待登记目录");
    await pendingCatalog.update({ where: { id: installed.id }, data: { snapshot: { ...installed.snapshot, unsafeRuntimeRole: true } } });
    expect(await list()).toMatchObject({ directCandidateSourceStatus: "unavailable", directCandidates: null, candidates: [] });
    await pendingCatalog.update({ where: { id: installed.id }, data: { snapshot: installed.snapshot } });
    await server.store.table("contractVersion").update({ where: { id: draft.created.version.id }, data: { amountYuan: null } });
    expect((await list()).directCandidates).toEqual([]);
    await server.store.prisma.contract.update({ where: { id: near.contractId }, data: { name: "签章原件合同" } });
    expect((await list()).directCandidates).toHaveLength(1);
    await server.store.prisma.contract.update({ where: { id: near.contractId }, data: { name: "正式合同" } });
    await server.store.table("contractVersion").update({ where: { id: draft.created.version.id }, data: { amountYuan: new Prisma.Decimal("100.0000") } });

    await server.store.prisma.projectAffiliateContractFact.updateMany({ where: { ledgerId: externalLedgerId }, data: { amountCents: 8000n } });
    await server.store.prisma.contractVersion.update({ where: { id: near.versionId }, data: { amountYuan: new Prisma.Decimal("90.0000") } });
    await seedDirectReviewDatabaseBinding(server);
    const pin = { sourceRef: directRef, contractVersionId: draft.created.version.id,
      sourceRevision: savedBody.directSigningInput.sourceRevision, inputSha256: savedBody.directSigningInput.inputSha256 };
    const prepared = await fetch(draft.base + "/contract-economic-reviews", { method: "POST", headers: draft.headers,
      body: JSON.stringify({ projectId: draft.projectId, leftSourceRef: directRef, rightSourceRef: formalRef,
        relation: "independent", coverage: [], reason: "实际履约各自独立", idempotencyKey: randomUUID(),
        confirmationPassword: server.password, expectedDirectSources: [pin] }) });
    const review = await prepared.json();
    expect({ status: prepared.status, body: review }).toMatchObject({ status: 201, body: { status: "pending_review" } });
    expect((await list()).directCandidates).toHaveLength(1);
    await server.store.prisma.projectMember.create({ data: { projectId: draft.projectId, userId: "director", positionKey: "contract_director" } });
    const signatureBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=", "base64");
    const signature = await server.files.uploadPrivateFile({ originalName: "复核签字.png", mimeType: "image/png", sizeBytes: signatureBytes.length,
      buffer: signatureBytes, uploadedByUserId: "director" });
    await server.store.prisma.handwrittenSignatureVersion.create({ data: { userId: "director", source: "canvas", fileId: signature.id,
      contentSha256: createHash("sha256").update(signatureBytes).digest("hex") } });
    const director = await loginTemplateActor(server, "director");
    const confirmed = await fetch(`${draft.base}/contract-economic-reviews/${review.id}/decision`, { method: "POST",
      headers: { ...draft.headers, authorization: `Bearer ${director}` },
      body: JSON.stringify({ revision: 1, decision: "confirm", confirmationPassword: server.password }) });
    expect({ status: confirmed.status, body: await confirmed.json() }).toMatchObject({ status: 201, body: { status: "confirmed" } });
    expect((await list()).directCandidates).toEqual([]);

    const tiedReview = await server.store.table("contractEconomicReview").findUnique({ where: { id: review.id } });
    if (!tiedReview) throw new Error("缺少已确认复核夹具");
    const tiedId = randomUUID();
    await server.store.table("contractEconomicReview").create({ data: { ...tiedReview, id: tiedId, idempotencyKey: randomUUID() } });
    const references = server.store.table("contractEconomicReviewFileReference");
    for (const reference of await references.findMany({ where: { reviewId: review.id } })) {
      await references.create({ data: { ...reference, id: randomUUID(), reviewId: tiedId } });
    }
    expect((await list()).directCandidates).toHaveLength(1);
    await references.deleteMany({ where: { reviewId: tiedId } });
    await server.store.table("contractEconomicReview").deleteMany({ where: { id: tiedId } });

    await server.store.table("directReviewInputDigestObservation").create({ data: {
      versionId: pin.contractVersionId, sourceRevision: pin.sourceRevision, originalSignedNumber: "重新核对的原号", inputSha256: "e".repeat(64)
    } });
    await server.store.table("contractVersion").update({ where: { id: pin.contractVersionId }, data: { originalSignedNumber: "重新核对的原号" } });
    expect((await list()).directCandidates).toHaveLength(1);
  } finally {
    await server.app.close();
  }
});
