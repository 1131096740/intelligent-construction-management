import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { canonicalContractPlaceholder } from "../contract-document/contract-placeholder-registry";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { createTemplateTestServer } from "./template-management.test-support";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MOTHER_SHA = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const ADAPTER_SHA = "81c5d2ed351d747941f4b239e24a6af5b73defc5caeb9b5513ee19fbf90343c5";
const LOCK_SHA = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const EXPECTED_TOTAL = "1.本合同暂定总价（含税）：人民币叁元整。适用税率：0%。";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Source44be all16 XML/rels parts and fixture schema do not consume this optional field.
 * This is pre-registered before the first export, not chosen from observed output.
 * Actual Word equivalence below still compares all text/style/XML properties.
 */
function comparableRenderInput(input: { values: Record<string, unknown> }) {
  const { ["document.generatedAt"]: generatedAt, ...values } = input.values;
  expect(typeof generatedAt).toBe("string");
  expect(Number.isNaN(Date.parse(generatedAt as string))).toBe(false);
  return { input: { ...input, values }, generatedAt };
}

function members(bytes: Buffer) {
  const zip = new PizZip(bytes);
  return Object.fromEntries(Object.values(zip.files).filter(file => !file.dir)
    .map(file => [file.name, file.asNodeBuffer()] as const));
}

/** Strict parser/serializer comparison; no ignored text/style/MC attributes. */
function documentView(bytes: Buffer, stripAddedMargins: boolean) {
  const doc = new DOMParser().parseFromString(bytes.toString("utf8"), "application/xml");
  expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  const allMargins = Array.from(doc.getElementsByTagNameNS(W, "tblCellMar"));
  expect(allMargins).toHaveLength(3);
  const wordParent = (node: Element, name: string) => {
    const parent = node.parentNode;
    return parent?.nodeType === 1 && (parent as Element).namespaceURI === W && (parent as Element).localName === name;
  };
  const margins = allMargins.filter(node => wordParent(node, "tblPr"));
  const rowExceptions = allMargins.filter(node => wordParent(node, "tblPrEx"));
  expect(margins).toHaveLength(2);
  expect(rowExceptions).toHaveLength(1);
  // This existing row-level108 exception is a negative-control anchor, not an added80 margin.
  for (const [side, value] of [["top", "0"], ["left", "108"], ["bottom", "0"], ["right", "108"]]) {
    const nodes = rowExceptions[0].getElementsByTagNameNS(W, side);
    expect(nodes.length).toBe(1);
    expect(nodes.item(0)?.getAttributeNS(W, "w")).toBe(value);
    expect(nodes.item(0)?.getAttributeNS(W, "type")).toBe("dxa");
  }
  expect(rowExceptions[0].getElementsByTagNameNS(W, "start").length).toBe(0);
  expect(rowExceptions[0].getElementsByTagNameNS(W, "end").length).toBe(0);
  for (const margin of margins) {
    for (const side of ["start", "end"]) {
      const node = margin.getElementsByTagNameNS(W, side).item(0)!;
      expect(node?.getAttributeNS(W, "w")).toBe("80");
      expect(node?.getAttributeNS(W, "type")).toBe("dxa");
    }
    for (const side of ["left", "right"]) {
      const nodes = Array.from(margin.getElementsByTagNameNS(W, side));
      expect(nodes).toHaveLength(stripAddedMargins ? 1 : 0);
      if (stripAddedMargins) {
        expect(nodes[0].getAttributeNS(W, "w")).toBe("80");
        expect(nodes[0].getAttributeNS(W, "type")).toBe("dxa");
        margin.removeChild(nodes[0]);
      }
    }
  }
  return {
    xml: new XMLSerializer().serializeToString(doc),
    paragraphs: Array.from(doc.getElementsByTagNameNS(W, "p")).map(p =>
      Array.from(p.getElementsByTagNameNS(W, "t")).map(t => t.textContent ?? "").join(""))
  };
}

function assertOnlyMarginDifference(baseline: Buffer, control: Buffer) {
  const left = members(baseline), right = members(control);
  expect(Object.keys(right).sort()).toEqual(Object.keys(left).sort());
  for (const name of Object.keys(left).filter(name => name !== "word/document.xml")) {
    expect({ name, sha256: digest(right[name]) }).toEqual({ name, sha256: digest(left[name]) });
  }
  const leftView = documentView(left["word/document.xml"], false);
  const rightView = documentView(right["word/document.xml"], true);
  expect(rightView.paragraphs).toEqual(leftView.paragraphs);
  expect(rightView.xml).toBe(leftView.xml);
  return {
    nonDocumentMemberHashes: Object.fromEntries(Object.keys(left).filter(name => name !== "word/document.xml").map(name => [name, digest(left[name])])),
    paragraphCount: leftView.paragraphs.length,
    visibleCodepoints: [...leftView.paragraphs.join("")].length,
    mainXmlWithoutOnlyAddedMarginsSha256: digest(Buffer.from(leftView.xml)),
    comparedAllExistingXmlTextStylesAndAttributes: true
  };
}

/** Current v2 normalizes both equivalent sources to the same physical margins. */
function assertCurrentV2RenderedEquivalence(baseline: Buffer, control: Buffer) {
  const left = members(baseline), right = members(control);
  expect(Object.keys(right).sort()).toEqual(Object.keys(left).sort());
  // Assert exact global80 and original row108 on both, before full-part comparison.
  const leftView = documentView(left["word/document.xml"], true);
  const rightView = documentView(right["word/document.xml"], true);
  expect(rightView.paragraphs).toEqual(leftView.paragraphs);
  expect(rightView.xml).toBe(leftView.xml);
  for (const name of Object.keys(left)) {
    expect({ name, sha256: digest(right[name]) }).toEqual({ name, sha256: digest(left[name]) });
  }
  return { allWordMemberHashes: Object.fromEntries(Object.keys(left).map(name => [name, digest(left[name])])),
    paragraphCount: leftView.paragraphs.length, comparedAllExistingXmlTextStylesAndAttributes: true,
    globalLeftRightDxa: 80, preservedRowExceptionDxa: 108, tableLayoutVersion: "body-bill-loop-v2" };
}

describe("task10 current-v2 equivalent-source public margin control", () => {
  it("normalizes two equivalent sources to identical current-v2 Word output from the same normal draft", async () => {
    const root = process.env.TASK10_MARGIN_CONTROL_OUTPUT;
    if (!root || !process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") {
      throw new Error("边距隔离核查需要显式自有输出目录及原锁定运行时");
    }
    if (process.env.SKIP_DATABASE_CONNECT) throw new Error("业务公开链不接受数据库跳过标记");
    const directory = resolve(root);
    const baselineSource = await readFile(join(directory, "baseline-source.docx"));
    const controlSource = await readFile(join(directory, "control-source.docx"));
    const proof = JSON.parse(await readFile(join(directory, "input-byte-proof.json"), "utf8")) as {
      motherSourceSHA: string; baselineSourceSHA: string; controlSourceSHA: string
    };
    const mother = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
    expect(digest(mother)).toBe(MOTHER_SHA);
    expect(proof.motherSourceSHA).toBe(MOTHER_SHA);
    expect(digest(baselineSource)).toBe(proof.baselineSourceSHA);
    expect(digest(controlSource)).toBe(proof.controlSourceSHA);
    expect(digest(baselineSource)).not.toBe(MOTHER_SHA);
    expect(digest(controlSource)).not.toBe(MOTHER_SHA);
    const motherMembers = members(mother), commonMembers = members(baselineSource);
    expect(Object.keys(commonMembers).sort()).toEqual(Object.keys(motherMembers).sort());
    for (const name of Object.keys(motherMembers).filter(name => name !== "word/document.xml")) {
      expect(commonMembers[name]).toEqual(motherMembers[name]);
    }
    const motherXml = motherMembers["word/document.xml"].toString("utf8");
    expect(motherXml.split("{税率}%")).toHaveLength(2);
    // The one common editable-source correction is byte-exact, preserving namespace/MC and styles.
    expect(commonMembers["word/document.xml"]).toEqual(Buffer.from(motherXml.replace("{税率}%", "{税率}")));
    // Before any native conversion, prove S0/control differ only by the four added margin elements.
    const sourceEquivalence = assertOnlyMarginDifference(baselineSource, controlSource);
    await writeFile(join(directory, "source-equivalence.json"), JSON.stringify(sourceEquivalence, null, 2), { flag: "wx" });
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const receipts: Array<Record<string, unknown>> = [];
    let baselineWord: Buffer | undefined;
    let baselineRenderInput: unknown;
    let baselineRequiredKeys: unknown;
    try {
      // One ordinary draft retains its legitimate generated number across the two template selections.
      // No synthetic business-number override or literal-to-field rebinding is used.
      const draft = await createTask09Draft(server);
      for (const [label, source] of [["baseline", baselineSource], ["control", controlSource]] as const) {
        const caseDirectory = join(directory, label);
        await mkdir(caseDirectory);
        const layout = await confirmedBodyLayout(server, source, "materials");
        const selected = await saveTask09Draft(server, draft, "material_purchase", layout.id);
        expect(selected.status === 200 ? "OK" : await selected.text()).toBe("OK");
        const saved = await saveBody(draft, undefined, "当前单甲方", [{
          clientRowKey: "margin-control-row", sortOrder: 0, itemName: "材料", unit: "吨",
          quantity: "1", unitPrice: "3", taxRatePercent: "0", customData: {}
        }]);
        expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
        const bodyResponse = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
        expect(bodyResponse.status).toBe(200);
        const body = await bodyResponse.json() as Body & { draftRevision: number };
        expect(body.sourceSha256).toBe(layout.sha256);
        const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ sourceRevision: body.draftRevision }) });
        expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
        const generation = await queued.json() as { generationId: string };
        const listResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
        expect(listResponse.status).toBe(200);
        const list = await listResponse.json() as Array<{ id: string; status: string; inputSnapshot: {
          renderInput: { values: Record<string, unknown> }; requiredKeys: string[];
          layoutSourceMapping: { bindings: Array<{ fieldKey: string }> };
          bodyDocument: { pdfEngine: string; runtimeLockSha256: string; sourceSha256: string; editPlan?: unknown }
        } }>;
        const pending = list.find(item => item.id === generation.generationId)!;
        expect(pending).toMatchObject({ status: "queued", inputSnapshot: { bodyDocument: { pdfEngine: "docx4j-17.3.5", runtimeLockSha256: LOCK_SHA, sourceSha256: layout.sha256 } } });
        expect(pending.inputSnapshot.bodyDocument.editPlan).toBeUndefined();
        expect(pending.inputSnapshot).toMatchObject({ bodyDocument: { tableLayoutVersion: "body-bill-loop-v2" },
          renderInput: { values: { "contract.tableLayoutVersion": "body-bill-loop-v2" } } });
        const bindingKeys = [...new Set(pending.inputSnapshot.layoutSourceMapping.bindings.map(binding => binding.fieldKey))].sort();
        expect(bindingKeys).toEqual(["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"].sort());
        expect(pending.inputSnapshot.requiredKeys.map(canonicalContractPlaceholder)).not.toContain("document.generatedAt");
        expect(pending.inputSnapshot.renderInput.values).toMatchObject({
          "contract.amount": "3.0000", "contract.amountUppercase": "人民币叁元整",
          "field.taxRatePercent": "0%", "contract.amountBasis": "tax_inclusive",
          "contract.renderSemanticVersion": "contract-money-v1"
        });
        const comparedInput = comparableRenderInput(pending.inputSnapshot.renderInput);
        if (label === "baseline") {
          baselineRenderInput = comparedInput.input;
          baselineRequiredKeys = pending.inputSnapshot.requiredKeys;
        } else {
          // Stop before the second native call if normal producer inputs have drifted.
          expect(comparedInput.input).toEqual(baselineRenderInput);
          expect(pending.inputSnapshot.requiredKeys).toEqual(baselineRequiredKeys);
        }
        expect(await server.processor.processNext()).toBe(true);
        const outputResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
        expect(outputResponse.status).toBe(200);
        const output = (await outputResponse.json() as Array<{ id: string; status: string; docxFileId: string; pdfFileId: string;
          inputSnapshot: { inspection: { runtime: Record<string, unknown> } } }>).find(item => item.id === generation.generationId)!;
        expect(output).toMatchObject({ status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String), inputSnapshot: { inspection: { runtime: {
          adapterSourceSha256: ADAPTER_SHA, runtimeLockSha256: LOCK_SHA, conversionCalls: 1, boundaryDenials: 3,
          childEnvironmentKeys: ["LANG", "LC_ALL", "PATH", "TMPDIR"]
        } } } });
        const files: Partial<Record<"docx" | "pdf", Buffer>> = {};
        for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
          const ticket = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket`, { method: "POST", headers: draft.headers,
            body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "隔离格式反例：核对原表格边距映射，不作正式采纳" }) });
          expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
          const { downloadUrl } = await ticket.json() as { downloadUrl: string };
          const download = await fetch(`${await server.app.getUrl()}${downloadUrl}`);
          expect(download.status).toBe(200);
          files[format] = Buffer.from(await download.arrayBuffer());
          await writeFile(join(caseDirectory, `actual.${format}`), files[format]!, { flag: "wx" });
        }
        // Independently assert the full visible scalar sentence on each actual output.
        // Both non44be source hashes deliberately use the same normal generic formatter branch.
        const renderedView = documentView(members(files.docx!)["word/document.xml"], true);
        expect(renderedView.paragraphs.filter(text => text.startsWith("1.本合同暂定总价"))).toEqual([EXPECTED_TOTAL]);
        if (label === "baseline") baselineWord = files.docx!;
        else {
          const renderedEquivalence = assertCurrentV2RenderedEquivalence(baselineWord!, files.docx!);
          await writeFile(join(directory, "rendered-word-equivalence.json"), JSON.stringify(renderedEquivalence, null, 2), { flag: "wx" });
        }
        const receipt = { label, sourceSha256: layout.sha256, generationId: generation.generationId,
          docxSha256: digest(files.docx!), pdfSha256: digest(files.pdf!), runtime: output.inputSnapshot.inspection.runtime,
          unconsumedTransportMetadata: { "document.generatedAt": comparedInput.generatedAt },
          verdict: "PUBLIC_EXPORT_ONLY_GEOMETRY_PENDING", formalAdoption: false };
        receipts.push(receipt);
        await writeFile(join(caseDirectory, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
      }
      await writeFile(join(directory, "paired-public-export.json"), JSON.stringify({ sourceEquivalence, receipts,
        conclusion: "Current-v2 equivalent-source fresh public pairs; exact Word member equivalence, physical PDF geometry pending", originalGISUsedAsFreshBaseline: false }, null, 2), { flag: "wx" });
    } catch (cause) {
      await writeFile(join(directory, "failure.json"), JSON.stringify({ error: String(cause), completed: receipts }, null, 2), { flag: "wx" });
      throw cause;
    } finally { await server.app.close(); }
  }, 90_000);
});
