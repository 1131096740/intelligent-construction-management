"use strict";

const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");

function signedSettlementVerification(baseUrl, projectId) {
  const origin = new URL(baseUrl);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "已签结算验收拒绝非本机 API");
  const base = `/projects/${encodeURIComponent(projectId)}/signed-contract-settlements`;
  const authorization = (token) => ({ Authorization: `Bearer ${token}` });
  async function request(method, suffix, token, body, expected = method === "POST" ? 201 : 200) {
    const response = await fetch(new URL(base + suffix, origin), {
      method,
      headers: { ...authorization(token), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    assert.equal(response.status, expected, `已签结算验收 ${method} ${suffix || '/'} HTTP ${response.status}`);
    return response.json();
  }
  async function upload(token, fileName, pageCount) {
    const pdf = await PDFDocument.create();
    for (let page = 0; page < pageCount; page++) pdf.addPage();
    const bytes = new Uint8Array(await pdf.save());
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName);
    const response = await fetch(new URL(`${base}/files`, origin), { method: "POST", headers: authorization(token), body: form });
    assert.equal(response.status, 201, "已签结算原件上传失败");
    const file = await response.json();
    return { id: file.id, bytes, fileName };
  }
  async function verifyOriginal(token, settlementId, file, downloadReason) {
    const attachment = `/${encodeURIComponent(settlementId)}/attachments/${encodeURIComponent(file.id)}`;
    const meta = await request("GET", attachment, token);
    assert.equal(meta.originalName, file.fileName);
    const ticket = await request("POST", `${attachment}/download-ticket`, token, { downloadReason });
    assert.equal(ticket.fileId, file.id);
    const ttl = Date.parse(ticket.expiresAt) - Date.now();
    assert(ttl > 0 && ttl <= 300_000, "已签结算原件下载票据有效期错误");
    const response = await fetch(new URL(ticket.downloadUrl, origin), { headers: authorization(token) });
    assert.equal(response.status, 200, "已签结算原件下载失败");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), file.bytes);
  }
  async function submit(record, token) {
    const row = await request("POST", `/${encodeURIComponent(record.id)}/submission`, token, { revision: record.revision });
    assert.equal(row.state, "pending_review");
    return row;
  }
  async function confirm(record, token) {
    const row = await request("POST", `/${encodeURIComponent(record.id)}/review`, token, {
      revision: record.revision, decision: "confirm"
    });
    assert.equal(row.state, "confirmed");
    return row;
  }
  return { request, upload, submit, confirm, verifyOriginal };
}

module.exports = { signedSettlementVerification };
