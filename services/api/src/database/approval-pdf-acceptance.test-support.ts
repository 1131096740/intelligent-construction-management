import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { PrismaService } from "./prisma.service";

/** Real HTTP/PG acceptance only: never creates approval or signature evidence. */
export async function verifyApprovedPdf(input: {
  db: PrismaService; baseUrl: string; token: string; password: string;
  businessType: string; businessId: string; roles: string[]; label: string;
}) {
  const { db, businessType, businessId } = input;
  const instance = await db.approvalInstance.findFirstOrThrow({
    where: { businessType, businessId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  assert.equal(instance.status, "approved");
  const all = await db.approvalActionLog.findMany({ where: { approvalInstanceId: instance.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const lastReset = all.reduce((last, row, index) => ["return_to_applicant", "payer_changed_reapproval"].includes(row.action) ? index : last, -1);
  const actions = all.slice(lastReset + 1).filter(row => row.action === "approve");
  assert.deepEqual(actions.map(row => row.approvedRoleKey), input.roles);
  const evidence = [];
  for (const action of actions) {
    assert.ok(action.signatureVersionIdSnapshot);
    const signature = await db.handwrittenSignatureVersion.findUniqueOrThrow({ where: { id: action.signatureVersionIdSnapshot } });
    assert.equal(signature.userId, action.actorUserId);
    assert.equal(signature.fileId, action.signatureFileIdSnapshot);
    assert.equal(signature.contentSha256, action.signatureSha256Snapshot);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: signature.fileId } });
    assert.equal(file.uploadedByUserId, action.actorUserId);
    const bytes = await readFile(join(process.env.FILE_STORAGE_ROOT!, file.objectKey));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), action.signatureSha256Snapshot);
    const metadata = action.metadata as Record<string, unknown>;
    assert.equal(typeof metadata.approverName, "string");
    assert.ok(metadata.approverName);
    evidence.push({ actionId: action.id, actorUserId: action.actorUserId, role: action.approvedRoleKey,
      name: metadata.approverName, signedAt: action.createdAt, signatureVersionId: signature.id,
      signatureFileId: file.id, signatureSha256: signature.contentSha256 });
  }
  const response = await fetch(`${input.baseUrl}/approval-forms/${businessType}/${businessId}/download`, {
    method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
    body: JSON.stringify({ confirmationPassword: input.password, downloadReason: "本地审批与签名一致性验收" })
  });
  if (response.status !== 201) throw new Error(`${input.label} 审批单下载失败，状态码 ${response.status}：${await response.text()}`);
  assert.match(response.headers.get("content-type") ?? "", /application\/pdf/u);
  const bytes = Buffer.from(await response.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 0);
  const directory = process.env.APPROVAL_V6_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    const fileName = `${input.label}-${businessId}`;
    await writeFile(join(directory, `${fileName}.pdf`), bytes);
    await writeFile(join(directory, `${fileName}.json`), JSON.stringify({ label: input.label,
      businessType, businessId, instanceId: instance.id, source: "real-http-postgresql",
      pageCount: pdf.getPageCount(), pdfSha256: createHash("sha256").update(bytes).digest("hex"), actions: evidence
    }, null, 2));
  }
}
