import { task10HttpRepository } from "./task10-http-repository.test-support";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { prepareLayoutSourceMapping, readLayoutSourcePositions } from "./layout-field-mapping";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 explicit selected template replacement real UI", () => {
  it("accepts an actual new-layout body command after both normal switch and nonbody save acknowledgements without reloading", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-template-switch-body-command-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-template-switch-body-command-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      // Existing immutable published synthetic fixture, not template-publication acceptance.
      const original = await confirmedBodyLayout(server, source, "materials", "material_purchase", "原版材料合同");
      const alternative = await confirmedBodyLayout(server, source, "materials", "material_purchase", "备选材料合同");
      expect(original.id).not.toBe(alternative.id);
      expect(original.sha256).toBe(alternative.sha256);
      const clean = await createTask09Draft(server);
      const catalogResponse = await fetch(`${await server.app.getUrl()}/contract-layout-templates?contractTypeKey=material_purchase`, { headers: clean.headers });
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json();
      expect(catalog).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "原版材料合同", layoutTemplateVersionId: original.id, contractTypeKey: "material_purchase" }),
        expect.objectContaining({ name: "备选材料合同", layoutTemplateVersionId: alternative.id, contractTypeKey: "material_purchase" })
      ]));
      const qualified = await saveTask09Draft(server, clean, "material_purchase", alternative.id);
      expect(qualified.status === 200 ? "OK" : await qualified.text()).toBe("OK");
      const cleanBodyResponse = await fetch(clean.base + "/document-body", { headers: clean.headers });
      expect(cleanBodyResponse.status).toBe(200);
      const cleanBody = await cleanBodyResponse.json();
      expect(cleanBody).toMatchObject({ layoutTemplateVersionId: alternative.id, sourceSha256: original.sha256 });
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", original.id)).status).toBe(200);
      const rows = [{ clientRowKey: "switch-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json();
      const ordinary = body.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(ordinary).toBeDefined();
      const additionId = "template-switch-saved-addition";
      expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: original.id, sourceSha256: original.sha256,
        edits: [{ positionId: ordinary.id, text: ordinary.text + "原有人工条款需保留。" }],
        additions: [{ id: additionId, afterPositionId: ordinary.id, text: "更换模板前已保存的新增约定。" }]
      }, "当前单甲方", rows)).status).toBe(200);
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      await writeFile(join(directory, "public-alternative-eligibility.json"), JSON.stringify({ catalog, cleanBodyLayout: cleanBody.layoutTemplateVersionId, cleanBodySource: cleanBody.sourceSha256, sourceScope: "same44be/independent syntheticpublishedrecords; notdifferentWordsource or actualpublication" }, null, 2));
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-template-switch-body-command.config.ts", "--project=desktop", "--max-failures=1", "--grep", "换版及名称回执后刷新前可确认当前模板正文命令$"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: { id: draft.contract.id }, version: { id: draft.version.id }, additionId, ordinaryId: ordinary.id, originalOrdinaryText: ordinary.text }, original, alternative, sourceSha256: original.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10同源记录换模板覆盖确认真实桌面证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10换模板覆盖浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});


describe("A07 different-source same-type template replacement real UI", () => {
  it("preserves an acknowledged name edit on cancel and explicitly replaces the complete body from ef9 to original 3a", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-A07-cross-source-ui-"));
    const sourcePaths = ["services/api/src/contract-template/task10-template-switch-body-command-browser.http.spec.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/layout-field-mapping.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true, legacyWorkbenchReads: true });
    try {
      const originalBytes = await readFile(join(repository, "services/api/assets/templates/generic-contract-v1.docx"));
      const alternativeBytes = await readFile(join(repository, "scripts/probes/task08-documents/samples/generic-contract-v1.docx"));
      const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      expect(hash(originalBytes)).toBe("ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d");
      expect(hash(alternativeBytes)).toBe("3a3d0fb5e9b5e49798f3773f213296b9cfa224874d14bda6aa89006b63bd366a");
      const sourcePositions = readLayoutSourcePositions(originalBytes);
      const fields = [
        ["word/document.xml", 5, "{合同名称}", 0, 6, "contract.name"],
        ["word/document.xml", 12, "合同编号：{草稿编号}", 5, 11, "contract.temporaryCode"],
        ["word/document.xml", 13, "甲方：建工智管建设有限公司", 3, 13, "party.owner.name"],
        ["word/document.xml", 14, "乙方：{相对方名称}", 3, 10, "party.counterparty.name"],
        ["word/document.xml", 53, "甲方（盖章）：建工智管建设有限公司", 7, 17, "party.owner.name"],
        ["word/document.xml", 58, "乙方（盖章）：{相对方名称}", 7, 14, "party.counterparty.name"],
        ["word/header1.xml", 0, "{文档水印}", 0, 6, "document.watermark"]
      ] as const;
      const bindings = fields.map(([part, paragraphIndex, text, start, end, fieldKey]) => {
        const position = sourcePositions.positions.find(item => item.part === part && item.paragraphIndex === paragraphIndex)!;
        expect(position.text).toBe(text);
        return { positionId: position.positionId, start, end, fieldKey };
      });
      const file = await server.files.uploadPrivateFile({ originalName: "原通用ef9.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: originalBytes.length, buffer: originalBytes, uploadedByUserId: "director" });
      const { mapping } = prepareLayoutSourceMapping(originalBytes, file.id, 1, bindings);
      const templateId = randomUUID(), original = { id: randomUUID(), sha256: hash(originalBytes), name: "原通用ef9" };
      await server.store.prisma.contractLayoutTemplate.create({ data: { id: templateId, name: original.name, contractTypeKey: "other" } });
      await server.store.prisma.contractLayoutTemplateVersion.create({ data: { id: original.id, layoutTemplateId: templateId, versionNo: 1, status: "published", draftRevision: 1, docxFileId: file.id, publishedAt: new Date(), publishedByUserId: "director", previewPdfFileId: "synthetic-confirmed-preview", placeholderSchema: { bills: [{ key: "genericItems" }], sourceMapping: { ...mapping, confirmation: { sourceFileId: file.id, sourceSha256: mapping.sourceSha256, draftRevision: 1, mappingFingerprint: mapping.fingerprint, previewJobId: "synthetic-confirmation-job", previewPdfFileId: "synthetic-confirmed-preview" } } }, inspectionReport: { status: "passed", requiredKeys: [] } } });
      const alternative = { ...await confirmedBodyLayout(server, alternativeBytes, "genericItems", "other", "目标原通用3a", [["contract.pricingNatureLabel", ["计价方式"]], ["field.invoiceType", ["发票类型"]]]), name: "目标原通用3a" };
      expect(original.sha256).not.toBe(alternative.sha256);
      const clean = await createTask09Draft(server, "capped", "other");
      const catalogResponse = await fetch(`${await server.app.getUrl()}/contract-layout-templates?contractTypeKey=other`, { headers: clean.headers });
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json();
      expect(catalog).toEqual(expect.arrayContaining([expect.objectContaining({ name: original.name, layoutTemplateVersionId: original.id, contractTypeKey: "other" }), expect.objectContaining({ name: alternative.name, layoutTemplateVersionId: alternative.id, contractTypeKey: "other" })]));
      expect((await saveTask09Draft(server, clean, "other", alternative.id)).status).toBe(200);
      const targetResponse = await fetch(clean.base + "/document-body", { headers: clean.headers });
      expect(targetResponse.status).toBe(200);
      const targetBody = await targetResponse.json();
      expect(targetBody).toMatchObject({ sourceSha256: alternative.sha256, layoutTemplateVersionId: alternative.id });
      const draft = await createTask09Draft(server, "capped", "other");
      expect((await saveTask09Draft(server, draft, "other", original.id)).status).toBe(200);
      const rows = [{ clientRowKey: "different-source-row", sortOrder: 0, itemName: "跨源清单项", unit: "项", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json();
      const ordinary = body.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text === "第四条 特别约定");
      expect(ordinary).toBeDefined();
      const manualText = ordinary.text + "原跨源人工补句保留。", additionId = "a07-different-source-addition", additionText = "原跨源已保存新增约定。";
      expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: original.id, sourceSha256: original.sha256, edits: [{ positionId: ordinary.id, text: manualText }], additions: [{ id: additionId, afterPositionId: ordinary.id, text: additionText }] }, "当前单甲方", rows)).status).toBe(200);
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      await writeFile(join(directory, "source-qualification.json"), JSON.stringify({ original, alternative, originalBindings: mapping.bindings, targetBody, catalog, scope: "Two exact different sources; synthetic immutable published catalogs, not publication/adoption acceptance" }, null, 2));
      Object.defineProperty(server, "store", { get() { throw new Error("跨源准备后不得私读store"); } });
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-template-switch-body-command.config.ts", "--project=desktop", "--max-failures=1", "--grep", "跨不同原源更换模板时取消不写入且确认整篇替换$"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: { id: draft.contract.id }, version: { id: draft.version.id }, ordinaryId: ordinary.id, manualText, additionId, additionText }, original, alternative, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info("A07真实不同源切换UI证据：" + directory);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error("A07真实跨源UI失败，证据 " + directory + "\n" + output, { cause });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 250_000);
});
