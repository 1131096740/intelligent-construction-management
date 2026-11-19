import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function withoutEquivalentAliases(bytes: Buffer) {
  const zip = new PizZip(bytes);
  const xml = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "application/xml");
  const tables = Array.from(xml.getElementsByTagNameNS(W, "tbl"));
  expect(tables).toHaveLength(2);
  for (const table of tables) {
    const properties = Array.from(table.childNodes).find(node => node.nodeType === 1 && (node as Element).localName === "tblPr") as Element;
    const margin = Array.from(properties.childNodes).find(node => node.nodeType === 1 && (node as Element).localName === "tblCellMar") as Element;
    for (const [logical, alias] of [["start", "left"], ["end", "right"]]) {
      const leading = Array.from(margin.childNodes).filter(node => node.nodeType === 1 && (node as Element).localName === logical) as Element[];
      expect(leading).toHaveLength(1);
      expect(leading[0].getAttributeNS(W, "w")).toBe("80");
      expect(leading[0].getAttributeNS(W, "type")).toBe("dxa");
      const aliases = Array.from(margin.childNodes).filter(node => node.nodeType === 1 && (node as Element).localName === alias) as Element[];
      expect(aliases.length).toBeLessThanOrEqual(1);
      for (const value of aliases) {
        expect(value.getAttributeNS(W, "w")).toBe("80");
        expect(value.getAttributeNS(W, "type")).toBe("dxa");
        margin.removeChild(value);
      }
    }
  }
  return { main: new XMLSerializer().serializeToString(xml), nonMain: Object.fromEntries(Object.keys(zip.files).filter(name => !zip.files[name].dir && name !== "word/document.xml").map(name => [name, sha(zip.file(name)!.asNodeBuffer())])) };
}

describe("task10 logical table margin actual equivalence", () => {
  it("matches the explicit same-level alias80 control in actual PDF geometry without altering row108", async () => {
    const sources = process.env.TASK10_LOGICAL_MARGIN_SOURCES;
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    const oracle = process.env.TASK10_LOGICAL_MARGIN_ORACLE;
    if (!sources || !python || !oracle || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("边距实际检查需要明确的受控源、只读测量工具及锁定运行时");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-logical-margin-equivalence-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourceBytes = await Promise.all(["baseline-source.docx", "control-source.docx"].map(name => readFile(join(sources, name))));
      expect(sourceBytes.map(sha)).toEqual(["57d372ca7fd72f9a6a8fb4dbb21ead1e9eabba5714d39758c6c119857406b1ec", "74ab1b57568fd02155a39943cbe38727899eee06e3b68d73f3207183e03f65d6"]);
      expect(withoutEquivalentAliases(sourceBytes[0])).toEqual(withoutEquivalentAliases(sourceBytes[1]));
      const draft = await createTask09Draft(server);
      const results: Array<{ label: string; values: Record<string, unknown>; docxSha256: string; pdfSha256: string; directory: string; widths: number[]; rowGaps: number[]; snapshot: unknown }> = [];
      for (const [index, label] of ["logical80", "explicit80"].entries()) {
        const out = join(directory, label); await mkdir(out);
        const layout = await confirmedBodyLayout(server, sourceBytes[index], "materials");
        expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
        const save = await saveBody(draft, undefined, "当前单甲方", [{ clientRowKey: "margin-row", sortOrder: 0, itemName: "边距核对材料", unit: "项", quantity: "1", unitPrice: "3.0000", taxRatePercent: "0", customData: {} }]);
        expect(save.status === 200 ? "OK" : await save.text()).toBe("OK");
        const state = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
        expect(state.version.amountYuan).toBe("3.0000");
        const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: state.version.draftRevision }) });
        expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
        const created = await queued.json();
        const documentsUrl = await server.app.getUrl() + "/contract-workbench/" + draft.version.id + "/documents";
        const before = (await fetch(documentsUrl, { headers: draft.headers }).then(response => response.json())).find((value: { id: string }) => value.id === created.generationId);
        const values = { ...before.inputSnapshot.renderInput.values }; delete values["document.generatedAt"];
        if (results.length) expect(values).toEqual(results[0].values);
        expect(before.inputSnapshot.bodyDocument.pdfEngine).toBe("docx4j-17.3.5");
        expect(await server.processor.processNext()).toBe(true);
        const output = (await fetch(documentsUrl, { headers: draft.headers }).then(response => response.json())).find((value: { id: string }) => value.id === created.generationId);
        expect(output).toMatchObject({ status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
        const files: Buffer[] = [];
        for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]]) {
          const ticket = await fetch(await server.app.getUrl() + "/files/" + fileId + "/download-ticket", { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对逻辑表格边距与同层等值别名输出" }) });
          expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
          const { downloadUrl } = await ticket.json();
          const response = await fetch(await server.app.getUrl() + downloadUrl); expect(response.status).toBe(200);
          const bytes = Buffer.from(await response.arrayBuffer()); files.push(bytes); await writeFile(join(out, "actual." + format), bytes);
        }
        const word = new DOMParser().parseFromString(new PizZip(files[0]).file("word/document.xml")!.asText(), "application/xml");
        const paragraphs = Array.from(word.getElementsByTagNameNS(W, "p")).map(node => Array.from(node.getElementsByTagNameNS(W, "t")).map(text => text.textContent ?? "").join(""));
        expect(paragraphs).toContain("1.本合同暂定总价（含税）：人民币叁元整。适用税率：0%。");
        const signatureException = word.getElementsByTagNameNS(W, "tbl")[1].getElementsByTagNameNS(W, "tblPrEx")[0];
        expect(signatureException).toBeDefined();
        for (const side of ["left", "right"]) expect(signatureException.getElementsByTagNameNS(W, "tblCellMar")[0].getElementsByTagNameNS(W, side)[0].getAttributeNS(W, "w")).toBe("108");
        expect(output.inputSnapshot.inspection.runtime.exportedDocxSha256).toBe(sha(files[0]));
        inspectActualTemplatePdf(files[0], files[1], "task10-logical-margin-" + label, output.inputSnapshot.inspection.runtime);
        await promisify(execFile)(python, [oracle, "--pdf", join(out, "actual.pdf"), "--docx", join(out, "actual.docx"), "--expected-pdf-sha", sha(files[1]), "--output-dir", join(out, "geometry")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
        const association = JSON.parse(await readFile(join(out, "geometry/source-role-association.json"), "utf8"));
        expect(association.status).toBe("ASSOCIATED_OBSERVATIONS_ONLY");
        expect(association.bodySourceCount).toBeGreaterThan(0);
        expect(association.bodyActualCount).toBe(association.bodySourceCount);
        expect(association.matchedPrefix).toBe(association.bodySourceCount);
        expect(association.tables.map((table: { status: string }) => table.status)).toEqual(["ASSOCIATED_OBSERVATION_ONLY", "ASSOCIATED_OBSERVATION_ONLY"]);
        const widths = association.tables.map((table: { outerWidthSourcePt: number }) => table.outerWidthSourcePt);
        const rowGaps = association.tables[1].rows[0].cells.map((cell: { firstGlyphLeadingGapSourcePt: number }) => cell.firstGlyphLeadingGapSourcePt);
        for (const gap of rowGaps) expect(Math.abs(gap - 108 / 20)).toBeLessThanOrEqual(0.1);
        results.push({ label, values, docxSha256: sha(files[0]), pdfSha256: sha(files[1]), directory: out, widths, rowGaps, snapshot: output.inputSnapshot });
        await writeFile(join(directory, "paired-public-evidence.json"), JSON.stringify({ results, purpose: "draft", legalSigningAcceptance: false, limits: "Width equivalence to explicit source aliases only; no complete padding/clip/font/Word equivalence claim; cleanup fixture warnings retained" }, null, 2));
      }
      const old = withoutEquivalentAliases(await readFile(join(results[0].directory, "actual.docx")));
      const control = withoutEquivalentAliases(await readFile(join(results[1].directory, "actual.docx")));
      expect(old).toEqual(control);
      const deltas = results[0].widths.map((value: number, index: number) => value - results[1].widths[index]);
      await writeFile(join(directory, "geometry-verdict.json"), JSON.stringify({ widths: results.map(value => value.widths), deltas, toleranceSourcePt: 0.1, target: "logical80 is semantically equivalent to same-level explicit aliases80, not metadata version or hardcoded433.2", verdict: "PENDING" }, null, 2));
      console.info("逻辑80与显式80实际外宽：" + JSON.stringify({ directory, deltas }));
      for (const delta of deltas) expect(Math.abs(delta)).toBeLessThanOrEqual(0.1);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("逻辑边距公开实际检查失败，证据 " + directory, { cause });
    } finally { await server.app.close(); }
  }, 150_000);
});
