import PizZip from "pizzip";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");

describe("A07 original mechanical selectable positions",()=>{
  it("keeps the original readonly page footer while exposing the mechanical business anchors",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"jg-task10-A07-mechanical-position-")),server=await createTemplateTestServer();
    try{
      const source=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/equipment-rental-real-v1.docx"));const sourceSha=hash(source);expect(sourceSha).toBe("9139d5eb2905cb659e90c00f053c8b17c40d265bca5c660da5d2d8e1028d4c32");
      const token=await loginTemplateActor(server,"director"),base=await server.app.getUrl(),headers={authorization:"Bearer "+token,"content-type":"application/json"};
      const form=new FormData();form.append("file",new Blob([new Uint8Array(source)]),"原十列机械.docx");const upload=await fetch(base+"/files",{method:"POST",headers:{authorization:headers.authorization},body:form});expect(upload.status).toBe(201);const file=await upload.json();
      const created=await fetch(base+"/contract-layout-templates",{method:"POST",headers,body:JSON.stringify({name:"原机械页码只读位置核验",contractTypeKey:"equipment_rental",docxFileId:file.id,placeholderSchema:{bills:[{key:"equipmentRentals"}]}})});expect(created.status).toBe(201);const layout=await created.json();
      const response=await fetch(base+"/contract-layout-template-versions/"+layout.version.id+"/source-positions",{headers});const data=await response.json();await writeFile(join(directory,"positions.json"),JSON.stringify({sourceSha,layout,status:response.status,data},null,2));
      expect(response.status).toBe(200);expect(data.sourceSha256).toBe(sourceSha);expect(data.positions.filter((x:{part:string})=>x.part==="word/document.xml").length).toBeGreaterThan(80);expect(data.positions.filter((x:{part:string})=>x.part==="word/footer1.xml")).toEqual([]);
      expect(data.positions.filter((x:{text:string})=>x.text.includes("{甲方名称}")).length).toBe(3);expect(data.positions.filter((x:{text:string})=>x.text.includes("{乙方名称}")).length).toBe(3);
      const fields = [["合同名称", "contract.name"], ["甲方名称", "party.owner.name"], ["乙方名称", "party.counterparty.name"], ["合同编号", "contract.temporaryCode"], ["文档水印", "document.watermark"], ["不含税总额", "contract.taxExclusiveAmount"]];
      const bindings = data.positions.flatMap((position: { positionId: string; text: string }) => fields.flatMap(([name, fieldKey]) => {
        const token = `{${name}}`, start = position.text.indexOf(token);
        return start < 0 ? [] : [{ positionId: position.positionId, start, end: start + token.length, fieldKey }];
      }));
      const mapped = await fetch(base + "/contract-layout-template-versions/" + layout.version.id + "/source-mapping", { method: "PATCH", headers, body: JSON.stringify({ expectedRevision: 1, sourceFileId: file.id, sourceSha256: sourceSha, bindings }) });
      const mappedData = await mapped.json();
      await writeFile(join(directory, "explicit-mapping.json"), JSON.stringify({ bindings, status: mapped.status, mappedData }, null, 2));
      expect(mapped.status === 200 ? "OK" : JSON.stringify(mappedData)).toBe("OK");
      expect(mappedData).toMatchObject({ draftRevision: 2, confirmed: false });
      expect(mappedData.mappingFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      const detail = await fetch(base + "/contract-layout-templates/" + layout.template.id, { headers });
      expect(detail.status).toBe(200);
      const savedVersion = (await detail.json()).versions.find((version: { id: string }) => version.id === layout.version.id);
      const savedMapping = savedVersion.placeholderSchema.sourceMapping;
      expect(savedMapping).toMatchObject({ sourceFileId: file.id, sourceSha256: sourceSha, draftRevision: 2, fingerprint: mappedData.mappingFingerprint });
      expect(savedMapping.bindings.map((binding: { positionId: string; start: number; end: number; fieldKey: string }) => JSON.stringify([binding.positionId, binding.start, binding.end, binding.fieldKey])).sort()).toEqual(bindings.map((binding: { positionId: string; start: number; end: number; fieldKey: string }) => JSON.stringify([binding.positionId, binding.start, binding.end, binding.fieldKey])).sort());
      const net = data.positions.find((position: { text: string }) => position.text === "{不含税总额}");
      expect(bindings.find((binding: { fieldKey: string }) => binding.fieldKey === "contract.taxExclusiveAmount")).toEqual({ positionId: net.positionId, start: 0, end: 7, fieldKey: "contract.taxExclusiveAmount" });
      const derivedNet = mappedData.preview.find((position: { text: string }) => position.text === "{contract.taxExclusiveAmount}");
      expect(derivedNet).toMatchObject({ part: "word/document.xml", paragraphIndex: net.paragraphIndex });
      expect(derivedNet.positionId).not.toBe(net.positionId);
      await writeFile(join(directory, "mapping-readback.json"), JSON.stringify({ savedMapping, derivedPreview: mappedData.preview }, null, 2));
      const ticket=await fetch(base+"/files/"+file.id+"/download-ticket",{method:"POST",headers,body:JSON.stringify({confirmationPassword:server.password,downloadReason:"核对页码源未被改写"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const original=await fetch(base+value.downloadUrl);expect(original.status).toBe(200);expect(hash(Buffer.from(await original.arrayBuffer()))).toBe(sourceSha);console.info("A07原机械位置证据："+directory);
    }catch(cause){await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("原机械公有位置失败，证据 "+directory,{cause});}finally{await server.processor.onApplicationShutdown();await server.app.close();}
  });
});

describe("mechanical footer exception remains closed for unknown nested content",()=>{
  it("rejects a changed footer containing a business placeholder rather than silently skipping it",async()=>{
    const server=await createTemplateTestServer();
    try {
      const original=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/equipment-rental-real-v1.docx"));const zip=new PizZip(original),footer=zip.file("word/footer1.xml")!.asText();const changed=footer.replace("<w:t>1</w:t>","<w:t>{甲方名称}</w:t>");expect(changed).not.toBe(footer);zip.file("word/footer1.xml",changed);const source=zip.generate({type:"nodebuffer"});expect(hash(source)).not.toBe(hash(original));
      const token=await loginTemplateActor(server,"director"),base=await server.app.getUrl(),headers={authorization:"Bearer "+token,"content-type":"application/json"};const form=new FormData();form.append("file",new Blob([new Uint8Array(source)]),"合成未知嵌套反例.docx");const uploaded=await fetch(base+"/files",{method:"POST",headers:{authorization:headers.authorization},body:form});expect(uploaded.status).toBe(201);const file=await uploaded.json();
      const created=await fetch(base+"/contract-layout-templates",{method:"POST",headers,body:JSON.stringify({name:"未知嵌套页脚负控",contractTypeKey:"equipment_rental",docxFileId:file.id,placeholderSchema:{bills:[{key:"equipmentRentals"}]}})});expect(created.status).toBe(201);const layout=await created.json();const response=await fetch(base+"/contract-layout-template-versions/"+layout.version.id+"/source-positions",{headers});expect(response.status).toBe(400);expect((await response.json()).message).toBe("模板包含嵌套正文段落，请拆分后重新上传");
    }finally{await server.processor.onApplicationShutdown();await server.app.close();}
  });
});


describe("new mechanical rendering aliases preserve existing ordinary edits", () => {
  it("keeps a custom source's ordinary fuel, operator and net-amount token paragraph editable", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const zip = new PizZip(syntheticWordSource(true));
      zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("<w:sectPr>", '<w:p><w:r><w:t>原普通字段：{是否含燃油}、{是否带操作人员}、{不含税总额}</w:t></w:r></w:p><w:sectPr>'));
      const loop = '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>{#机械租赁清单}{itemName}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{是否含燃油}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{是否带操作人员}{/机械租赁清单}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
      zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("<w:sectPr>", loop + "<w:sectPr>"));
      const layout = await confirmedBodyLayout(server, zip.generate({ type: "nodebuffer" }), "equipmentRentals");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [
        { clientRowKey: "unknown-null", sortOrder: 0, itemName: "NULL行", unit: "项", quantity: "1", unitPrice: "1", taxRatePercent: "0", customData: { fuelIncluded: null, operatorIncluded: null } },
        { clientRowKey: "unknown-missing", sortOrder: 1, itemName: "缺值行", unit: "项", quantity: "1", unitPrice: "1", taxRatePercent: "0", customData: {} },
        { clientRowKey: "existing-chinese", sortOrder: 2, itemName: "已有中文行", unit: "项", quantity: "1", unitPrice: "1", taxRatePercent: "0", customData: { 是否含燃油: "按约定", 是否带操作人员: "是" } }
      ];
      const initialSave = await saveBody(draft, undefined, "当前单甲方", rows);
      expect(initialSave.status === 200 ? "OK" : await initialSave.text()).toBe("OK");
      const response = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(response.status).toBe(200);
      const body = await response.json();
      const ordinary = body.blocks.find((block: { text: string }) => block.text.startsWith("原普通字段："));
      expect(ordinary).toMatchObject({ editable: true });
      expect(ordinary.text).toContain("【待补充：是否含燃油】");
      expect(ordinary.text).toContain("【待补充：是否带操作人员】");
      const table = body.flow.find((item: { kind: string }) => item.kind === "table");
      expect(table.rows).toHaveLength(3);
      for (const [index, row] of table.rows.entries()) for (const column of [1, 2]) {
        expect(row.cells[column].paragraphIds.map((id: string) => body.blocks.find((block: { id: string }) => block.id === id)?.text ?? "").join("")).toBe(index === 2 ? column === 1 ? "按约定" : "是" : "");
      }
      const manual = "原普通字段：燃油及操作人员按人工约定办理。";
      const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: manual }] }, "当前单甲方", rows);
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const reread = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(reread.status).toBe(200);
      expect((await reread.json()).blocks.find((block: { id: string }) => block.id === ordinary.id)).toMatchObject({ editable: true, text: manual });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });
});
