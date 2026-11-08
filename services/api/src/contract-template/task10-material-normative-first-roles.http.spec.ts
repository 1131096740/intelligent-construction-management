import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string };

describe("task10 first confirmed material normative roles through public body HTTP", () => {
  it("keeps cover and editable source positions while applying body-title and first-article font requirements", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-normative-first-roles-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "normative-material-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      const factSave = await saveBody(draft, undefined, "当前单甲方", rows);
      expect(factSave.status === 200 ? "OK" : await factSave.text()).toBe("OK");
      const firstResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(firstResponse.status).toBe(200);
      const before = await firstResponse.json() as PublicBody;
      // Distinguish duplicate titles by source document order and adjacent source
      // semantics, never by whichever title already has the desired formatting.
      const firstOrder = before.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph")
        .map(node => before.blocks.find(block => block.id === node.paragraphId)!);
      expect(firstOrder.every(Boolean)).toBe(true);
      const titles = firstOrder.filter(block => block.text === "上游新建当前合同名称");
      expect(titles).toHaveLength(2);
      const [cover, bodyTitle] = titles;
      const coverAt = firstOrder.indexOf(cover), bodyAt = firstOrder.indexOf(bodyTitle);
      expect(coverAt).toBeLessThan(bodyAt);
      expect(firstOrder.slice(coverAt + 1, bodyAt).some(block => block.text.startsWith("合同编号："))).toBe(true);
      expect(firstOrder.slice(coverAt + 1, bodyAt).some(block => block.text.startsWith("签订日期："))).toBe(true);
      const articleText = "第一条  货物名称、规格型号、数量、价格等";
      const articles = firstOrder.filter(block => block.text === articleText);
      expect(articles).toHaveLength(1);
      const article = articles[0], articleAt = firstOrder.indexOf(article);
      expect(bodyAt).toBeLessThan(articleAt);
      expect(firstOrder.slice(bodyAt + 1, articleAt).some(block => block.text.trim() === "买方：当前单甲方")).toBe(true);
      expect(firstOrder.slice(bodyAt + 1, articleAt).some(block => block.text.trim() === "卖方：当前单乙方")).toBe(true);
      const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(ordinary).toBeDefined();
      const manualText = ordinary!.text + "双方人工补充约定应当保留。";
      // Existing numeric2 public helper: same facts as the current body-format
      // control (2 * 3.2500, 0% = gross/net6.5000, tax0); no render-profile write.
      const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha,
        edits: [{ positionId: ordinary!.id, text: manualText }] }, "当前单甲方", rows);
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(wbResponse.status).toBe(200);
      const workbench = await wbResponse.json();
      const response = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(response.status).toBe(200);
      const body = await response.json() as PublicBody;
      const afterCover = body.blocks.find(block => block.id === cover.id)!;
      const afterTitle = body.blocks.find(block => block.id === bodyTitle.id)!;
      const afterArticle = body.blocks.find(block => block.id === article.id)!;
      // Persist complete public readback before normative assertions can stop.
      await writeFile(join(directory, "public-observation.json"), JSON.stringify({ before, workbench, body,
        identifiedRoles: { coverId: cover.id, bodyTitleId: bodyTitle.id, firstArticleId: article.id, ordinaryId: ordinary!.id },
        normativeExpected: { bodyTitle: { fontFamily: "方正小标宋简体", fontSizePt: 22 }, firstArticle: { fontFamily: "黑体", fontSizePt: 14 } },
        exportOrNativeRequested: false }, null, 2));
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id,
        draftRevision: workbench.version.draftRevision, documentContentRevision: workbench.version.documentContentRevision });
      expect(workbench.version.amountYuan).toBe("6.5000");
      expect(workbench.bills).toHaveLength(1);
      expect(workbench.bills[0]).toMatchObject({ billKey: "main", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      expect(body.blocks.map(block => block.id)).toEqual(before.blocks.map(block => block.id));
      expect(body.blocks.map(block => [block.id, block.text, block.editable])).toEqual(before.blocks.map(block => [block.id, block.id === ordinary!.id ? manualText : block.text, block.editable]));
      expect(body.blocks.find(block => block.id === ordinary!.id)).toMatchObject({ text: manualText, editable: true });
      expect(afterCover).toMatchObject({ text: cover.text, editable: cover.editable, format: { fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" } });
      expect(afterTitle).toMatchObject({ text: bodyTitle.text, editable: bodyTitle.editable });
      expect(afterArticle).toMatchObject({ text: articleText, editable: article.editable });
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      // One combined normative comparison records both confirmed roles. No
      // guessed second-tier classification or unimplemented profile shape.
      expect([afterTitle, afterArticle].map(block => ({ id: block.id, fontFamily: block.format.fontFamily, fontSizePt: block.format.fontSizePt }))).toEqual([
        { id: bodyTitle.id, fontFamily: "方正小标宋简体", fontSizePt: 22 },
        { id: article.id, fontFamily: "黑体", fontSizePt: 14 }
      ]);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("材料规范字体首片失败，证据 " + directory, { cause });
    } finally {
      const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 30_000);
});
