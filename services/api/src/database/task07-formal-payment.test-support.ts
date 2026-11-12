import { Test } from "@nestjs/testing";
import type { Prisma, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import type { Task07PaymentFixture } from "./payment-execution-concurrency.spec";

type Identity = { id: string; token: string };
const signature = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

export async function prepareTask07FormalPayment(db: PrismaClient, fixture: Task07PaymentFixture) {
  const password = `Test-${randomUUID()}`;
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  try {
    const origin = await app.getUrl();
    const json = async <T>(method: string, path: string, token: string, body?: unknown) => {
      const response = await fetch(origin + path, {
        method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const value = await response.json() as T;
      if (!response.ok) throw new Error(`Task07 ${method} ${path} ${response.status} ${JSON.stringify(value)}`);
      return value;
    };
    const identity = async (id: string): Promise<Identity> => {
      const phone = `114-${randomUUID()}`;
      const credentials = { phone, passwordHash: await hash(password, 4), mustChangePassword: false };
      await db.user.upsert({
        where: { id }, create: { id, name: "付款并发正式链合成人员", ...credentials },
        update: credentials
      });
      const { tokens } = await json<{ tokens: { accessToken: string } }>("POST", "/auth/login", "", { phone, password });
      return { id, token: tokens.accessToken };
    };
    const uploadSignature = async (actor: Identity) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(signature)], { type: "image/png" }), "task07-signature.png");
      const uploaded = await fetch(origin + "/me/signature/canvas", {
        method: "POST", headers: { authorization: `Bearer ${actor.token}` }, body: form
      });
      if (uploaded.status !== 201) throw new Error(`Task07 签名上传失败 ${uploaded.status} ${await uploaded.text()}`);
    };
    const assign = async (actor: Identity, key: string, projectId?: string) => {
      const position = await db.position.upsert({ where: { key }, update: {}, create: { key, name: key } });
      await db.userPosition.create({ data: { userId: actor.id, positionId: position.id, projectId } });
      if (projectId) await db.projectMember.create({ data: { projectId, userId: actor.id, positionKey: key } });
    };
    const evidence = async (actor: Identity) => {
      const document = await PDFDocument.create();
      document.addPage().drawText(`Synthetic Task07 evidence ${randomUUID()}`);
      const documentBytes = await document.save();
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(documentBytes).buffer], { type: "application/pdf" }), "合成银行证据.pdf");
      const response = await fetch(origin + "/files", {
        method: "POST", headers: { authorization: `Bearer ${actor.token}` }, body: form
      });
      const value = await response.json() as { id: string };
      if (response.status !== 201) throw new Error(`Task07 文件上传失败 ${response.status} ${JSON.stringify(value)}`);
      return value;
    };
    const finance = await identity(fixture.actorUserId);
    const verifier = await identity(fixture.verifierUserId);
    const applicant = await identity(`${fixture.prefix}_applicant`);
    const comprehensive = await identity(`${fixture.prefix}_comprehensive`);
    const projectManager = await identity(`${fixture.prefix}_manager`);
    const chairman = await identity(`${fixture.prefix}_chairman`);
    await assign(comprehensive, "comprehensive_director");
    await assign(chairman, "chairman");
    const scenarios = [
      { scenario: fixture.scenarios.remaining, checks: [[fixture.vouchers.remainingA, 700], [fixture.vouchers.remainingB, 700]] },
      { scenario: fixture.scenarios.replay, checks: [[fixture.vouchers.replay, 400], ["other-project", 700]] },
      { scenario: fixture.scenarios.shortage, checks: [[fixture.vouchers.shortage, 500]] }
    ] as const;
    for (const { scenario } of scenarios) {
      await assign(applicant, "contract_staff", scenario.projectId);
      await assign(projectManager, "project_manager", scenario.projectId);
      await assign(verifier, "finance_director", scenario.projectId);
    }
    for (const reviewer of [comprehensive, projectManager, verifier, chairman]) await uploadSignature(reviewer);
    for (const { scenario, checks } of scenarios) {
      // The existing test bootstraps the settled contract. Supply its due-stage
      // and legacy confirmed archive so the public application can price it.
      await db.paymentTermsStage.create({ data: {
        paymentTermsVersionId: scenario.paymentTermsVersionId, name: "到期结算款",
        basis: "current_settlement", ratioBps: 10000, triggerAnchor: "settlement_effective",
        triggerEvent: "结算生效", dueDays: 0, originalText: "结算生效后付清本期结算款"
      } });
      const archived = await evidence(applicant);
      await db.settlementArchiveFile.create({ data: {
        settlementId: scenario.settlementId, fileId: archived.id, uploadedByUserId: applicant.id,
        confirmedByUserId: verifier.id, confirmedAt: new Date(Date.now() - 120_000), status: "confirmed"
      } });
      const payment = await json<{ id: string; businessEntrySnapshot: { values: Record<string, unknown> } }>(
        "POST", "/payments", applicant.token,
        { settlementId: scenario.settlementId, code: scenario.paymentId, requestedAmountCents: "1000" }
      );
      expect(payment.businessEntrySnapshot.values).toMatchObject({
        contractId: scenario.contractId, contractVersionId: scenario.contractVersionId, settlementId: scenario.settlementId,
        paymentSubjectType: "our_company"
      });
      scenario.paymentId = payment.id;
      for (const actor of [comprehensive, projectManager, verifier, chairman]) {
        const route = `/payments/${payment.id}`;
        const review = await json<{ reviewApprovalContext: Record<string, unknown> }>("GET", route, actor.token);
        const approved = await json<{ businessEntrySnapshot?: { values: Record<string, unknown> } }>(
          "POST", route + "/approval", actor.token,
          { ...review.reviewApprovalContext, decision: "approve", confirmationPassword: password }
        );
        if (actor === chairman) expect(approved.businessEntrySnapshot?.values).toEqual({ approvedAmountYuan: "10.00" });
      }
      for (const [voucherId, amountCents] of checks) {
        const accountNumber = "6222000011111111";
        const request = await json<{ id: string }>("POST", "/contract-bank-verifications", finance.token, {
          projectId: scenario.projectId, companyEntityId: fixture.companyId, accountNumber, bankReference: randomUUID(),
          direction: "outflow", amountCents: String(amountCents), occurredAt: new Date(Date.now() - 60_000).toISOString(),
          evidenceFileId: (await evidence(finance)).id, reason: "付款并发合成银行证据",
          idempotencyKey: randomUUID(), confirmationPassword: password
        });
        await json("POST", `/contract-bank-verifications/${request.id}/decision`, verifier.token, {
          decision: "confirm", accountNumber, holderEvidenceFileId: (await evidence(verifier)).id, confirmationPassword: password
        });
        fixture.bankReferences.set(voucherId, `contract-bank:${request.id}`);
      }
    }
  } finally {
    await app.close();
  }
}

export async function assertTask07BankClaimNegatives(db: PrismaClient, fixture: Task07PaymentFixture) {
  const scenario = fixture.scenarios.remaining;
  const observation = await db.verifiedBankTransactionObservation.findUniqueOrThrow({
    where: { reference: fixture.bankReferences.get(fixture.vouchers.remainingA) }
  });
  const otherProject = await db.verifiedBankTransactionObservation.findUniqueOrThrow({
    where: { reference: fixture.bankReferences.get("other-project") }
  });
  const currentRound = await db.approvalInstance.findFirstOrThrow({ where: { businessId: scenario.paymentId, status: "approved" } });
  await expect(db.$executeRaw`INSERT INTO "BankTransactionClaim" ("observationId") VALUES (${observation.id})`)
    .rejects.toThrow("inactive_company_repayment_only");
  await expect(db.$executeRaw`INSERT INTO "ContractProxyBankClaim" ("observationId") VALUES (${observation.id})`)
    .rejects.toThrow("inactive_company_repayment_only");
  for (const variation of ["wrong_amount", "wrong_holder", "wrong_claimant", "later_returned_round", "wrong_frozen_version", "wrong_bank_project"] as const) {
    await expect(db.$transaction(async (tx) => {
      if (variation === "later_returned_round") {
        await tx.approvalInstance.create({ data: {
          businessId: currentRound.businessId, businessType: currentRound.businessType, flowType: currentRound.flowType,
          applicantUserId: currentRound.applicantUserId, currentNodeIndex: currentRound.currentNodeIndex,
          frozenNodes: currentRound.frozenNodes as Prisma.InputJsonValue,
          status: "returned_to_applicant", createdAt: new Date(currentRound.createdAt.getTime() + 1)
        } });
      }
      if (variation === "wrong_frozen_version") {
        await tx.paymentRequest.update({ where: { id: scenario.paymentId }, data: { contractVersionId: fixture.scenarios.replay.contractVersionId } });
      }
      const execution = await tx.paymentExecution.create({ data: {
        idempotencyKey: randomUUID(), paymentRequestId: scenario.paymentId, settlementId: scenario.settlementId,
        paymentSubjectType: "our_company", companyEntityIdSnapshot: fixture.companyId,
        companyEntityNameSnapshot: variation === "wrong_holder" ? "其他主体" : observation.holderNameSnapshot,
        companyEntityCreditCodeSnapshot: observation.holderCreditCodeSnapshot,
        amountCents: variation === "wrong_amount" ? observation.amountCents - 1n : observation.amountCents,
        paidAt: observation.occurredAt, executedByUserId: fixture.actorUserId, voucherFileId: fixture.vouchers.remainingA
      } });
      await tx.contractBankEventClaim.create({ data: {
        observationId: variation === "wrong_bank_project" ? otherProject.id : observation.id,
        sourceType: "payment_execution", sourceId: execution.id,
        createdByUserId: variation === "wrong_claimant" ? fixture.verifierUserId : fixture.actorUserId
      } });
      throw new Error(`意外接受 Task07 反例 ${variation}`);
    })).rejects.toThrow("inactive_company_repayment_only");
  }
  expect(await db.paymentExecution.count({ where: { paymentRequestId: scenario.paymentId } })).toBe(0);
  expect(await db.contractBankEventClaim.count({ where: { observationId: observation.id } })).toBe(0);
}
