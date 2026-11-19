import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
type Flow = { kind: "paragraph"; paragraphId: string } | { kind: "table"; columns: number[]; rows: unknown[] };

describe("task10 accepted opaque bill-boundary addition compatibility", () => {
  it("keeps an accepted opening-boundary hand clause once and before the material tables through save, read and new queue", async () => {
    const referencePath = process.env.TASK10_OLD_BODY_READBACK;
    if (!referencePath) throw new Error("边界条款兼容检查需要已保留的旧公开正文来源");
    const referenceBytes = await readFile(referencePath);
    expect(hash(referenceBytes)).toBe("53b34a5e83646d3f708c5bc6c6b3abd0a0b3e8eab140485b5dccd6246738ab56");
    const reference = JSON.parse(referenceBytes.toString("utf8")) as Body & { flow: Flow[] };
    expect(reference.sourceSha256).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
    // Exact opaque position copied from the pre-fix public readback, not derived
    // from a private parser or the new renderer.
    const boundaryId = "14450c1d6f386e5136aeb231439f66517554f052185e9836898ff53c22cf0d21";
    const oldBoundary = reference.blocks.find(block => block.id === boundaryId)!;
    expect(oldBoundary).toMatchObject({ text: "", editable: false });
    const oldFirstTable = reference.flow.findIndex(node => node.kind === "table");
    expect(reference.flow[oldFirstTable - 1]).toEqual({ kind: "paragraph", paragraphId: boundaryId });
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(hash(source)).toBe(reference.sourceSha256);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [1, 2].map(index => ({ clientRowKey: "boundary-row-" + index, sortOrder: index - 1,
        itemName: "边界材料00" + index, unit: "项", quantity: "1", unitPrice: index + ".0000", taxRatePercent: "0", customData: {} }));
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const read = async () => {
        const response = await fetch(draft.base + "/document-body", { headers: draft.headers });
        expect(response.status).toBe(200);
        return await response.json() as Body & { draftRevision: number; flow: Flow[] };
      };
      const before = await read();
      expect(before.flow.filter(node => node.kind === "table").map(node => node.kind === "table" ? node.rows.length : 0)).toEqual([3, 1]);
      const ordinary = before.blocks.find(block => block.text.startsWith("4.若卖方违背"))!;
      const additionText = "原有人工补充保持在清单开始前，仅保留这一份。";
      const plan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
        edits: [], additions: [{ id: "legacy-opening-anchor", afterPositionId: boundaryId, text: additionText }] };
      const saved = await saveBody(draft, plan, "当前单甲方", rows);
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const assertRetained = (body: Body & { flow: Flow[] }) => {
        const added = body.blocks.filter(block => block.text.includes(additionText));
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ id: "added:legacy-opening-anchor", text: "补充条款1：" + additionText });
        const addedIndex = body.flow.findIndex(node => node.kind === "paragraph" && node.paragraphId === added[0].id);
        const boundaryIndex = body.flow.findIndex(node => node.kind === "paragraph" && node.paragraphId === boundaryId);
        const tableIndex = body.flow.findIndex(node => node.kind === "table");
        expect(addedIndex).toBe(boundaryIndex + 1);
        expect(addedIndex).toBeLessThan(tableIndex);
        expect(body.flow.filter(node => node.kind === "table").map(node => node.kind === "table" ? node.rows.length : 0)).toEqual([2, 2, 1]);
        expect(body.blocks.find(block => block.id === ordinary.id)?.text).toBe(ordinary.text);
        expect(body.sourceSha256).toBe(layout.sha256);
      };
      const after = await read(); assertRetained(after);
      const state = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
      expect(state.version.amountYuan).toBe("3.0000");
      expect(state.version.draftData.documentBody.additions).toEqual(plan.additions);
      const queue = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers,
        body: JSON.stringify({ sourceRevision: after.draftRevision }) });
      expect(queue.status === 201 ? "OK" : await queue.text()).toBe("OK");
      const generation = await queue.json();
      const list = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers });
      expect(list.status).toBe(200);
      const document = (await list.json()).find((item: { id: string }) => item.id === generation.generationId);
      expect(document).toMatchObject({ status: "queued", inputSnapshot: { bodyDocument: { tableLayoutVersion: "body-bill-loop-v2", editPlan: { additions: plan.additions } },
        renderInput: { values: { "contract.tableLayoutVersion": "body-bill-loop-v2" } } } });
      assertRetained(await read());
      expect(hash(await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx")))).toBe(reference.sourceSha256);
      console.info("BoundaryAdditionRetained", JSON.stringify({ occurrence: 1, opaqueOpeningAnchor: boundaryId, tableRows: [2, 2, 1], stage: "public save/read/queue only; no native proof" }));
    } finally { await server.app.close(); }
  }, 150_000);
});
