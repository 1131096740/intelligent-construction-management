import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("task10 explicit sole saved-addition deletion through the aggregate HTTP", () => {
  it("accepts only the named sole saved addition removal and retains original body facts without persisting the command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-sole-delete-http-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(hash(source)).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "sole-delete-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const initialResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json();
      expect(initial.sourceSha256).toBe(layout.sha256);
      const ordinary = initial.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(ordinary).toBeDefined();
      const additionId = "sole-saved-addition-http";
      const additionText = "唯一新增手工条款：此次明确删除本段。";
      const oldPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [],
        additions: [{ id: additionId, afterPositionId: ordinary.id, text: additionText }] };
      expect((await saveBody(draft, oldPlan, "当前单甲方", rows)).status).toBe(200);
      const stateResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(stateResponse.status).toBe(200);
      const state = await stateResponse.json();
      expect(state.version.draftData.documentBody).toEqual(oldPlan);
      expect(state.version.draftData.documentBodyAction).toBeUndefined();
      expect(state.version.amountYuan).toBe("6.5000");
      expect(state.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      const beforeResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json();
      expect(before.draftRevision).toBe(state.version.draftRevision);
      expect(before.blocks.find((block: { id: string }) => block.id === ordinary.id).text).toBe(ordinary.text);
      expect(before.blocks.filter((block: { id: string }) => block.id.startsWith("added:"))).toEqual([expect.objectContaining({ id: "added:" + additionId, editable: true, text: "补充条款1：" + additionText })]);
      const nextPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] };
      const action = { kind: "delete_saved_addition", additionId };
      await writeFile(join(directory, "public-before.json"), JSON.stringify({ sourceSha256: before.sourceSha256, draftRevision: before.draftRevision, documentContentRevision: before.documentContentRevision,
        oldPlan: state.version.draftData.documentBody, ordinary, amountYuan: state.version.amountYuan, nextPlan, action }, null, 2));
      const deleted = await saveBody(draft, nextPlan, "当前单甲方", rows, action);
      const responseText = await deleted.text();
      await writeFile(join(directory, "public-save-response.json"), JSON.stringify({ status: deleted.status, response: responseText }, null, 2));
      console.info("SoleSavedAdditionDeleteProtocol", JSON.stringify({ directory, status: deleted.status, response: responseText }));
      // This is the only first RED target: the existing bodyAction parser still
      // treats every action as regeneration and refuses this explicit command.
      expect(deleted.status).toBe(200);
      const receipt = JSON.parse(responseText);
      expect(receipt.serverRevision).toBe(state.version.draftRevision + 1);
      const afterResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(afterResponse.status).toBe(200);
      const after = await afterResponse.json();
      expect(after.sourceSha256).toBe(layout.sha256);
      expect(after.layoutTemplateVersionId).toBe(layout.id);
      expect(after.draftRevision).toBe(receipt.serverRevision);
      expect(after.documentContentRevision).toBe(before.documentContentRevision + 1);
      expect(after.blocks.some((block: { id: string }) => block.id.startsWith("added:"))).toBe(false);
      expect(after.blocks.map((block: { text: string }) => block.text)).toEqual(before.blocks.filter((block: { id: string }) => block.id !== "added:" + additionId).map((block: { text: string }) => block.text));
      expect(after.blocks.find((block: { id: string }) => block.id === ordinary.id).text).toBe(ordinary.text);
      const amounts = after.blocks.filter((block: { text: string }) => block.text === "6.5000");
      expect(amounts.length).toBeGreaterThan(0);
      for (const amount of amounts) expect(amount.editable).toBe(false);
      const rereadResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(rereadResponse.status).toBe(200);
      const reread = await rereadResponse.json();
      const storedPlan = reread.version.draftData.documentBody;
      expect(storedPlan).toMatchObject({ protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [] });
      for (const key of ["additions", "deletedPositionIds", "paragraphOrder"]) expect(storedPlan[key] ?? []).toEqual([]);
      expect(reread.version.draftData.documentBodyAction).toBeUndefined();
      expect(reread.version.amountYuan).toBe("6.5000");
      expect(reread.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      await writeFile(join(directory, "public-after.json"), JSON.stringify({ sourceSha256: after.sourceSha256, documentContentRevision: after.documentContentRevision, draftRevision: after.draftRevision,
        storedPlan, ordinaryText: after.blocks.find((block: { id: string }) => block.id === ordinary.id).text, amountYuan: reread.version.amountYuan, actionAbsent: reread.version.draftData.documentBodyAction === undefined }, null, 2));
    } finally { await server.app.close(); }
  }, 30_000);
  it("refuses an empty manual body without explicit deletion intent and publicly retains saved facts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-sole-delete-no-intent-http-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(hash(source)).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "sole-delete-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const initialResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json();
      expect(initial.sourceSha256).toBe(layout.sha256);
      const ordinary = initial.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(ordinary).toBeDefined();
      const additionId = "sole-saved-addition-http";
      const additionText = "唯一新增手工条款：此次明确删除本段。";
      const oldPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [],
        additions: [{ id: additionId, afterPositionId: ordinary.id, text: additionText }] };
      expect((await saveBody(draft, oldPlan, "当前单甲方", rows)).status).toBe(200);
      const stateResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(stateResponse.status).toBe(200);
      const state = await stateResponse.json();
      expect(state.version.draftData.documentBody).toEqual(oldPlan);
      expect(state.version.draftData.documentBodyAction).toBeUndefined();
      expect(state.version.amountYuan).toBe("6.5000");
      expect(state.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      const beforeResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json();
      expect(before.draftRevision).toBe(state.version.draftRevision);
      expect(before.blocks.find((block: { id: string }) => block.id === ordinary.id).text).toBe(ordinary.text);
      expect(before.blocks.filter((block: { id: string }) => block.id.startsWith("added:"))).toEqual([expect.objectContaining({ id: "added:" + additionId, editable: true, text: "补充条款1：" + additionText })]);
      const nextPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] };
      const action = undefined;
      await writeFile(join(directory, "public-before.json"), JSON.stringify({ sourceSha256: before.sourceSha256, draftRevision: before.draftRevision, documentContentRevision: before.documentContentRevision,
        oldPlan: state.version.draftData.documentBody, ordinary, amountYuan: state.version.amountYuan, nextPlan, action }, null, 2));
      const deleted = await saveBody(draft, nextPlan, "当前单甲方", rows, action);
      const responseText = await deleted.text();
      await writeFile(join(directory, "public-save-response.json"), JSON.stringify({ status: deleted.status, response: responseText }, null, 2));
      console.info("SoleSavedAdditionDeleteNoIntent", JSON.stringify({ directory, status: deleted.status, response: responseText }));
      expect(deleted.status).toBe(409);
      expect(JSON.parse(responseText).message).toBe("重新生成或更换模板将覆盖手工正文，请先确认覆盖影响，原内容已保留");
      const afterResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(afterResponse.status).toBe(200);
      const after = await afterResponse.json();
      expect(after.sourceSha256).toBe(layout.sha256);
      expect(after.layoutTemplateVersionId).toBe(layout.id);
      expect(after.draftRevision).toBe(before.draftRevision);
      expect(after.documentContentRevision).toBe(before.documentContentRevision);
      expect(after.blocks.filter((block: { id: string }) => block.id.startsWith("added:"))).toEqual(before.blocks.filter((block: { id: string }) => block.id.startsWith("added:")));
      expect(after.blocks.map((block: { text: string }) => block.text)).toEqual(before.blocks.map((block: { text: string }) => block.text));
      expect(after.blocks.find((block: { id: string }) => block.id === ordinary.id).text).toBe(ordinary.text);
      const amounts = after.blocks.filter((block: { text: string }) => block.text === "6.5000");
      expect(amounts.length).toBeGreaterThan(0);
      for (const amount of amounts) expect(amount.editable).toBe(false);
      const rereadResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(rereadResponse.status).toBe(200);
      const reread = await rereadResponse.json();
      const storedPlan = reread.version.draftData.documentBody;
      expect(storedPlan).toEqual(oldPlan);
      expect(reread.version.draftRevision).toBe(state.version.draftRevision);
      expect(reread.version.draftData.documentBodyAction).toBeUndefined();
      expect(reread.version.amountYuan).toBe("6.5000");
      expect(reread.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      await writeFile(join(directory, "public-after.json"), JSON.stringify({ sourceSha256: after.sourceSha256, documentContentRevision: after.documentContentRevision, draftRevision: after.draftRevision,
        storedPlan, ordinaryText: after.blocks.find((block: { id: string }) => block.id === ordinary.id).text, amountYuan: reread.version.amountYuan, actionAbsent: reread.version.draftData.documentBodyAction === undefined }, null, 2));
    } finally { await server.app.close(); }
  }, 30_000);
  it("refuses sole addition deletion intent that would also erase a saved ordinary clause edit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-sole-delete-other-manual-http-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(hash(source)).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "sole-delete-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const initialResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json();
      expect(initial.sourceSha256).toBe(layout.sha256);
      const ordinary = initial.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(ordinary).toBeDefined();
      const additionId = "sole-saved-addition-http";
      const additionText = "唯一新增手工条款：此次明确删除本段。";
      const editedOrdinaryText = ordinary.text + "保留的普通条款手工修订。";
      const oldPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: editedOrdinaryText }],
        additions: [{ id: additionId, afterPositionId: ordinary.id, text: additionText }] };
      expect((await saveBody(draft, oldPlan, "当前单甲方", rows)).status).toBe(200);
      const stateResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(stateResponse.status).toBe(200);
      const state = await stateResponse.json();
      expect(state.version.draftData.documentBody).toEqual(oldPlan);
      expect(state.version.draftData.documentBodyAction).toBeUndefined();
      expect(state.version.amountYuan).toBe("6.5000");
      expect(state.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      const beforeResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json();
      expect(before.draftRevision).toBe(state.version.draftRevision);
      expect(before.blocks.find((block: { id: string }) => block.id === ordinary.id).text).toBe(editedOrdinaryText);
      expect(before.blocks.filter((block: { id: string }) => block.id.startsWith("added:"))).toEqual([expect.objectContaining({ id: "added:" + additionId, editable: true, text: "补充条款1：" + additionText })]);
      const nextPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [] };
      const action = { kind: "delete_saved_addition", additionId };
      await writeFile(join(directory, "public-before.json"), JSON.stringify({ sourceSha256: before.sourceSha256, draftRevision: before.draftRevision, documentContentRevision: before.documentContentRevision,
        oldPlan: state.version.draftData.documentBody, ordinary, amountYuan: state.version.amountYuan, nextPlan, action }, null, 2));
      const deleted = await saveBody(draft, nextPlan, "当前单甲方", rows, action);
      const responseText = await deleted.text();
      await writeFile(join(directory, "public-save-response.json"), JSON.stringify({ status: deleted.status, response: responseText }, null, 2));
      console.info("SoleSavedAdditionDeleteOtherManual", JSON.stringify({ directory, status: deleted.status, response: responseText }));
      expect(deleted.status).toBe(409);
      expect(JSON.parse(responseText).message).toBe("删除新增条款的信息已变化，请保留当前输入并重新读取后重试");
      const afterResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(afterResponse.status).toBe(200);
      const after = await afterResponse.json();
      expect(after.sourceSha256).toBe(layout.sha256);
      expect(after.layoutTemplateVersionId).toBe(layout.id);
      expect(after.draftRevision).toBe(before.draftRevision);
      expect(after.documentContentRevision).toBe(before.documentContentRevision);
      expect(after.blocks.filter((block: { id: string }) => block.id.startsWith("added:"))).toEqual(before.blocks.filter((block: { id: string }) => block.id.startsWith("added:")));
      expect(after.blocks.map((block: { text: string }) => block.text)).toEqual(before.blocks.map((block: { text: string }) => block.text));
      expect(after.blocks.find((block: { id: string }) => block.id === ordinary.id).text).toBe(editedOrdinaryText);
      const amounts = after.blocks.filter((block: { text: string }) => block.text === "6.5000");
      expect(amounts.length).toBeGreaterThan(0);
      for (const amount of amounts) expect(amount.editable).toBe(false);
      const rereadResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(rereadResponse.status).toBe(200);
      const reread = await rereadResponse.json();
      const storedPlan = reread.version.draftData.documentBody;
      expect(storedPlan).toEqual(oldPlan);
      expect(reread.version.draftRevision).toBe(state.version.draftRevision);
      expect(reread.version.draftData.documentBodyAction).toBeUndefined();
      expect(reread.version.amountYuan).toBe("6.5000");
      expect(reread.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      await writeFile(join(directory, "public-after.json"), JSON.stringify({ sourceSha256: after.sourceSha256, documentContentRevision: after.documentContentRevision, draftRevision: after.draftRevision,
        storedPlan, ordinaryText: after.blocks.find((block: { id: string }) => block.id === ordinary.id).text, amountYuan: reread.version.amountYuan, actionAbsent: reread.version.draftData.documentBodyAction === undefined }, null, 2));
    } finally { await server.app.close(); }
  }, 30_000);
});
