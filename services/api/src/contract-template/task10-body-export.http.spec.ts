import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

describe("task10 body actual public dual-format export", () => {
  it("downloads the same saved ordinary edits and inserted clause in actual Word and PDF at one content revision", async () => {
    if (process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile" || !process.env.TASK10_PDF_FONT_DIR || !process.env.TEMPLATE_PDF_INSPECTOR_PYTHON) throw new Error("正文实际双格式检查需要显式自有font-profile及锁定检查器，不能跳过物理字形门");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-body-export-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const layout = await confirmedBodyLayout(server);
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const initial = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
      const ordinary = initial.blocks.find(block => block.text.startsWith("手工条款："))!;
      const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
        edits: [{ positionId: ordinary.id, text: "手工条款：运输按人工约定办理，四位金额1.5340保留。" }],
        additions: [{ id: "export-addition", afterPositionId: ordinary.id, text: "货到北区仓库后共同核对。" }] });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body & { draftRevision: number };
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
      const generation = await queued.json() as { generationId: string; documentContentRevision: number; documentContentFingerprint: string };
      expect(await server.processor.processNext()).toBe(true);
      const listed = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(listed.status).toBe(200);
      const outputs = await listed.json() as Array<{ id: string; status: string; docxFileId: string; pdfFileId: string; documentContentRevision: number; documentContentFingerprint: string; inputSnapshot?: { inspection?: { runtime?: unknown } } }>;
      const output = outputs.find(document => document.id === generation.generationId)!;
      expect(output).toMatchObject({ status: "success", documentContentRevision: body.documentContentRevision, documentContentFingerprint: generation.documentContentFingerprint });
      const files: Partial<Record<"docx" | "pdf", Buffer>> = {};
      for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket`, { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对完整正文同修订双格式实物" }) });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json() as { downloadUrl: string };
        const downloaded = await fetch(`${await server.app.getUrl()}${downloadUrl}`);
        expect(downloaded.status).toBe(200);
        files[format] = Buffer.from(await downloaded.arrayBuffer());
        await writeFile(join(directory, `actual.${format}`), files[format]!);
      }
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ generation, output, sourceSha256: layout.sha256,
        docxSha256: createHash("sha256").update(files.docx!).digest("hex"), pdfSha256: createHash("sha256").update(files.pdf!).digest("hex"), physical: "PENDING", scope: "actual guarded public downloads, synthetic DB/private storage" }, null, 2));
      const physicalText = inspectActualTemplatePdf(files.docx!, files.pdf!, "task10-complete-body", output.inputSnapshot?.inspection?.runtime);
      const inspected = await promisify(execFile)(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON, [resolve(__dirname, "task09-pdf-physical-inspector.py"), "--docx", join(directory, "actual.docx"), "--pdf", join(directory, "actual.pdf"), "--font-dir", process.env.TASK10_PDF_FONT_DIR, "--out-dir", join(directory, "strict-physical")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      await writeFile(join(directory, "strict-physical.log"), inspected.stdout + inspected.stderr);
      expect(JSON.parse(await readFile(join(directory, "strict-physical/receipt.json"), "utf8"))).toMatchObject({ verdict: "GREEN", failures: [] });
      const word = new DOMParser().parseFromString(new PizZip(files.docx!).file("word/document.xml")!.asText(), "application/xml");
      const wordText = Array.from(word.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "t")).map(node => node.textContent ?? "").join("");
      for (const expected of ["手工条款：运输按人工约定办理，四位金额1.5340保留。", "补充条款1：货到北区仓库后共同核对。", "甲方签章：当前单甲方", "乙方签章：当前单乙方"]) {
        expect(wordText).toContain(expected);
        expect(physicalText.replace(/\s/gu, "")).toContain(expected.replace(/\s/gu, ""));
      }
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")),
        physical: "GREEN", strictPhysicalReceipt: join(directory, "strict-physical/receipt.json"), businessLiterals: "Word and physical PDF both matched saved ordinary edits, added clause and signatures" }, null, 2));
      console.info(`任务10同修订双格式实物证据：${directory}`);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error(`任务10实物检查失败，证据保留于 ${directory}`, { cause });
    } finally { await server.app.close(); }
  }, 90_000);
});

import { randomUUID } from "node:crypto";
import { loginTemplateActor } from "./template-selection.test-support";

describe("task10 A07 exact professional source product tracer", () => {
  it("creates professional type, preserves a manual clause through party and money sync and exports the saved revision in both formats", async () => {
    const started = performance.now();
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-A07-professional-"));
    const phases: Array<Record<string, unknown>> = [];
    async function phase<T>(name: string, limit: number, work: () => Promise<T>) {
      const begin = performance.now(), budget = Math.min(limit, started + 170_000 - begin);
      if (budget <= 0) throw new Error("专业样张阶段预算耗尽");
      try { const value = await work(); if (performance.now() - begin > budget) throw new Error("专业样张阶段超预算"); phases.push({name, budgetMs:budget, seconds:(performance.now()-begin)/1000,exit:0}); return value; }
      catch(cause) {phases.push({name,budgetMs:budget,seconds:(performance.now()-begin)/1000,exit:1,message:cause instanceof Error?cause.message:"阶段失败"});throw cause;}
      finally {await writeFile(join(directory,"phases.json"),JSON.stringify(phases,null,2));}
    }
    const server = await createTemplateTestServer({draftWorkbench:true});
    const hash = (bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
    const sourceSha="6ae812af212498638036a24fbc7ce793497a82894a76b28b087b51a1cef366f4";
    const manualId="c8cc04fe0cdaad1fa90bffcd49919a49c9f3f51d468f836f8ea4803d8cd2c0ee";
    const manualText="专业手工补充：施工接口共同确认后保留。";
    try {
      const prepared=await phase("public-professional-create-edit-sync",10000,async()=>{
        const source=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/professional-subcontract-v1.docx"));expect(hash(source)).toBe(sourceSha);
        const layout=await confirmedBodyLayout(server,source,"genericItems","professional_subcontract","专业原源临时技术样张");
        const draft=await createTask09Draft(server,"capped","professional_subcontract");
        expect(draft.contract).toMatchObject({contractTypeKey:"professional_subcontract"});
        expect((await saveTask09Draft(server,draft,"professional_subcontract",layout.id)).status).toBe(200);
        const base=await server.app.getUrl();
        const director=await loginTemplateActor(server,"director");
        const positions=await fetch(base+"/contract-layout-template-versions/"+layout.id+"/source-positions",{headers:{authorization:"Bearer "+director}});expect(positions.status).toBe(200);
        const sourcePositions=await positions.json();expect(sourcePositions.sourceSha256).toBe(sourceSha);
        expect(sourcePositions.positions.find((x:{positionId:string})=>x.positionId===manualId)).toMatchObject({part:"word/document.xml",paragraphIndex:34,text:"{特别约定}"});
        const get=async(path:string)=>{const response=await fetch(draft.base+path,{headers:draft.headers});expect(response.status).toBe(200);return response.json();};
        const rows=(price:string)=>[1,2,3].map(index=>({clientRowKey:"a07-professional-"+index,sortOrder:index-1,itemName:"专业核验项00"+index,unit:"项",quantity:String(index),unitPrice:price,taxRatePercent:"0",customData:{}}));
        expect((await saveBody(draft,undefined,"A07专业甲方初始",rows("100.0000"))).status).toBe(200);
        const body=await get("/document-body");expect(body.blocks.find((x:{id:string})=>x.id===manualId)).toMatchObject({editable:true});
        const plan={protocolVersion:1,layoutTemplateVersionId:layout.id,sourceSha256:sourceSha,edits:[{positionId:manualId,text:manualText}],additions:[]};
        const manualSaved=await saveBody(draft,plan,"A07专业甲方初始",rows("100.0000"));expect(manualSaved.status===200?"OK":await manualSaved.text()).toBe("OK");
        const before=await get("/workbench");expect(before.version.amountYuan).toBe("600.0000");expect(before.version.draftData.contractBasics.businessType).toBe("professional_subcontract");
        const changed=await saveBody(draft,before.version.draftData.documentBody,"A07专业同步甲方",rows("120.0000"));expect(changed.status===200?"OK":await changed.text()).toBe("OK");
        const saved=await get("/workbench"), finalBody=await get("/document-body");
        expect(saved.version).toMatchObject({amountYuan:"720.0000",layoutTemplateVersionId:layout.id});
        expect(saved.version.draftData.documentBody).toEqual(before.version.draftData.documentBody);
        expect(finalBody).toMatchObject({sourceSha256:sourceSha,documentContentRevision:saved.version.documentContentRevision,draftRevision:saved.version.draftRevision});
        expect(finalBody.blocks.find((x:{id:string})=>x.id===manualId)).toMatchObject({text:manualText});
        const text=finalBody.blocks.map((x:{text:string})=>x.text).join("");expect(text).toContain("专业分包合同");expect(text).toContain("签章页");expect(text.match(/A07专业同步甲方/gu)).toHaveLength(2);expect(text).not.toContain("A07专业甲方初始");
        const repeat=await get("/workbench");expect(repeat.version).toEqual(saved.version);
        await writeFile(join(directory,"saved-public-facts.json"),JSON.stringify({sourceSha,layout,typeKey:"professional_subcontract",sourcePositions,manualId,manualText,before,saved,finalBody,fixtureScope:"Technical synthetic immutable published catalog; no formal adoption or template publication"},null,2));
        Object.defineProperty(server,"store",{get(){throw new Error("准备结束不得私读持久fixture");}});
        return {source,layout,draft,base,saved,finalBody};
      });
      const queued=await phase("public-queue-exact-saved-revision",7000,async()=>{
        const response=await fetch(prepared.draft.base+"/preview-generation",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({sourceRevision:prepared.saved.version.draftRevision})});expect(response.status===201?"OK":await response.text()).toBe("OK");
        const job=await response.json();expect(job).toMatchObject({status:"queued",documentContentRevision:prepared.saved.version.documentContentRevision,documentContentFingerprint:prepared.saved.version.documentContentFingerprint});return job;
      });
      const output=await phase("actual-docx4j-worker",130000,async()=>{
        expect(await server.processor.processNext()).toBe(true);
        const response=await fetch(prepared.base+"/contract-workbench/"+prepared.draft.version.id+"/documents",{headers:prepared.draft.headers});expect(response.status).toBe(200);const list=await response.json();const job=list.find((x:{id:string})=>x.id===queued.generationId);
        await writeFile(join(directory,"worker-public-result.json"),JSON.stringify({queued,job,sourceSha,savedVersion:prepared.saved.version},null,2));
        expect(job).toMatchObject({status:"success",documentContentRevision:prepared.saved.version.documentContentRevision,documentContentFingerprint:prepared.saved.version.documentContentFingerprint,inputSnapshot:{bodyDocument:{sourceSha256:sourceSha,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab",renderSemanticVersion:"contract-money-v1",tableLayoutVersion:"body-bill-loop-v2"}}});
        expect(job.inputSnapshot.bodyDocument.typographyVersion).toBeUndefined();expect(job.inputSnapshot.bodyDocument.signatureDateVersion).toBeUndefined();return job;
      });
      const actual=await phase("public-two-format-download-and-physical",25000,async()=>{
        const files:Partial<Record<"docx"|"pdf",Buffer>>={};
        for(const [format,id]of [["docx",output.docxFileId],["pdf",output.pdfFileId]]as const){const ticket=await fetch(prepared.base+"/files/"+id+"/download-ticket",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({confirmationPassword:server.password,downloadReason:"核对专业同修订Word和PDF",accessMode:format==="pdf"?"preview":"download"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const downloaded=await fetch(prepared.base+value.downloadUrl);expect(downloaded.status).toBe(200);files[format]=Buffer.from(await downloaded.arrayBuffer());await writeFile(join(directory,"actual."+format),files[format]!);}
        const normalization=output.inputSnapshot.inspection.packageMetadataNormalization;
        expect(normalization).toEqual({normalizationId:"professional-font-table-content-type-v1",originalMasterSha256:sourceSha,
          renderedDocxBeforeSha256:expect.stringMatching(/^[a-f0-9]{64}$/u),renderedDocxAfterSha256:hash(files.docx!),changedParts:["[Content_Types].xml"]});
        expect(normalization.renderedDocxBeforeSha256).not.toBe(normalization.renderedDocxAfterSha256);
        const exported=new PizZip(files.docx!), original=new PizZip(prepared.source);
        expect(exported.file("word/fontTable.xml")!.asNodeBuffer()).toEqual(original.file("word/fontTable.xml")!.asNodeBuffer());
        expect(exported.file("word/styles.xml")!.asNodeBuffer()).toEqual(original.file("word/styles.xml")!.asNodeBuffer());
        const originalTypes=new DOMParser().parseFromString(original.file("[Content_Types].xml")!.asText(),"application/xml");
        const exportedTypes=new DOMParser().parseFromString(exported.file("[Content_Types].xml")!.asText(),"application/xml");
        const typeRecords=(document: typeof originalTypes)=>Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types","*")).slice(1).map(node=>({kind:node.localName,part:node.getAttribute("PartName"),extension:node.getAttribute("Extension"),type:node.getAttribute("ContentType")}));
        expect(typeRecords(exportedTypes)).toEqual([...typeRecords(originalTypes),{kind:"Override",part:"/word/fontTable.xml",extension:null,type:"application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"}]);
        const xml=new DOMParser().parseFromString(exported.file("word/document.xml")!.asText(),"application/xml");const wordText=Array.from(xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","t")).map(x=>x.textContent??"").join("");
        const pdfText=inspectActualTemplatePdf(files.docx!,files.pdf!,"A07-exact-professional-saved-revision",output.inputSnapshot.inspection.runtime);
        for(const value of [manualText,"A07专业同步甲方","当前单乙方","专业分包合同","签章页","专业核验项001","专业核验项003","720.0000"]){expect(wordText).toContain(value);expect(pdfText.replace(/\s/gu,"")).toContain(value.replace(/\s/gu,""));}
        expect(wordText).not.toContain("A07专业甲方初始");return {docxSha256:hash(files.docx!),pdfSha256:hash(files.pdf!)};
      });
      await writeFile(join(directory,"verified-receipt.json"),JSON.stringify({sourceSha,typeKey:"professional_subcontract",billKey:"main",declaredLoop:"genericItems",queued,output,actual,verdict:"GREEN_SINGLE_SOURCE_ONLY",caseId:randomUUID(),scope:"One exact professional technical source current product path; not adoption/eight-source completion/whole Task10"},null,2));
      console.info("A07专业首纵向实际证据："+directory);
    }catch(cause){await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("A07专业首纵向失败，证据 "+directory,{cause});}
    finally{await server.processor.onApplicationShutdown();await server.app.close();}
  },190000);
});

describe("task10 A07 exact generic source product tracer", () => {
  it("creates generic type, preserves a manual clause through party and money sync and exports the saved revision in both formats", async () => {
    const started = performance.now();
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-A07-generic-"));
    const phases: Array<Record<string, unknown>> = [];
    async function phase<T>(name: string, limit: number, work: () => Promise<T>) {
      const begin = performance.now(), budget = Math.min(limit, started + 170_000 - begin);
      if (budget <= 0) throw new Error("通用样张阶段预算耗尽");
      try { const value = await work(); if (performance.now() - begin > budget) throw new Error("通用样张阶段超预算"); phases.push({name, budgetMs:budget, seconds:(performance.now()-begin)/1000,exit:0}); return value; }
      catch(cause) {phases.push({name,budgetMs:budget,seconds:(performance.now()-begin)/1000,exit:1,message:cause instanceof Error?cause.message:"阶段失败"});throw cause;}
      finally {await writeFile(join(directory,"phases.json"),JSON.stringify(phases,null,2));}
    }
    const server = await createTemplateTestServer({draftWorkbench:true});
    const hash = (bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
    const sourceSha="3a3d0fb5e9b5e49798f3773f213296b9cfa224874d14bda6aa89006b63bd366a";
    const manualId="577bac85b7f8093f489035ee0def241eed51c6a0e49fe538425451126449cc82";
    const manualText="原通用人工约定保留。";
    try {
      const prepared=await phase("public-generic-create-edit-sync",10000,async()=>{
        const source=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/generic-contract-v1.docx"));expect(hash(source)).toBe(sourceSha);
        const layout=await confirmedBodyLayout(server,source,"genericItems","other","通用原源临时技术样张",[["contract.pricingNatureLabel",["计价方式"]],["field.invoiceType",["发票类型"]]]);
        const draft=await createTask09Draft(server,"capped","other");
        expect(draft.contract).toMatchObject({contractTypeKey:"other"});
        expect((await saveTask09Draft(server,draft,"other",layout.id)).status).toBe(200);
        const base=await server.app.getUrl();
        const director=await loginTemplateActor(server,"director");
        const positions=await fetch(base+"/contract-layout-template-versions/"+layout.id+"/source-positions",{headers:{authorization:"Bearer "+director}});expect(positions.status).toBe(200);
        const sourcePositions=await positions.json();expect(sourcePositions.sourceSha256).toBe(sourceSha);
        const anchors = sourcePositions.positions.filter((position: { text: string }) => /\{(?:合同名称|合同编号|甲方名称|乙方名称|文档水印)\}/u.test(position.text));
        expect(anchors).toHaveLength(7);
        const priceSource = sourcePositions.positions.find((position: { text: string }) => position.text.startsWith("计价方式："));
        for (const [token, fieldKey] of [["{计价方式}", "contract.pricingNatureLabel"], ["{发票类型}", "field.invoiceType"]]) {
          const start = priceSource.text.indexOf(token);
          expect(sourcePositions.bindings.filter((binding: { fieldKey: string }) => binding.fieldKey === fieldKey)).toEqual([{ positionId: priceSource.positionId, start, end: start + token.length, fieldKey }]);
          expect(sourcePositions.fields.find((field: { key: string }) => field.key === fieldKey)).toMatchObject({ required: false });
        }
        expect(sourcePositions.mappingFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        expect(sourcePositions.confirmed).toBe(true);
        const mappingHeaders = { authorization: "Bearer " + director, "content-type": "application/json" };
        const mappingDraftResponse = await fetch(base + "/contract-layout-templates", { method: "POST", headers: mappingHeaders, body: JSON.stringify({ name: "通用可选字段公有映射草稿", contractTypeKey: "other", docxFileId: sourcePositions.sourceFileId, placeholderSchema: { bills: [{ key: "genericItems" }] } }) });
        expect(mappingDraftResponse.status === 201 ? "OK" : await mappingDraftResponse.text()).toBe("OK");
        const mappingDraft = await mappingDraftResponse.json();
        const mappingPath = base + "/contract-layout-template-versions/" + mappingDraft.version.id;
        const mappingSavedResponse = await fetch(mappingPath + "/source-mapping", { method: "PATCH", headers: mappingHeaders, body: JSON.stringify({ expectedRevision: 1, sourceFileId: sourcePositions.sourceFileId, sourceSha256: sourceSha, bindings: sourcePositions.bindings }) });
        expect(mappingSavedResponse.status === 200 ? "OK" : await mappingSavedResponse.text()).toBe("OK");
        const mappingSaved = await mappingSavedResponse.json();
        const mappingReadResponse = await fetch(mappingPath + "/source-positions", { headers: mappingHeaders });
        expect(mappingReadResponse.status).toBe(200);
        const publicMappingProof = await mappingReadResponse.json();
        expect(publicMappingProof).toMatchObject({ sourceSha256: sourceSha, sourceFileId: sourcePositions.sourceFileId, draftRevision: 2, mappingFingerprint: mappingSaved.mappingFingerprint, confirmed: false, bindings: sourcePositions.bindings });
        expect(mappingSaved.preview.find((position: { text: string }) => position.text.startsWith("计价方式：")).text).toContain("{contract.pricingNatureLabel}；发票类型：{field.invoiceType}");
        expect(mappingSaved.mappingFingerprint).not.toBe(sourcePositions.mappingFingerprint);
        expect(sourcePositions.positions.find((x:{positionId:string})=>x.positionId===manualId)).toMatchObject({part:"word/document.xml",paragraphIndex:34,text:"{特别约定}"});
        const get=async(path:string)=>{const response=await fetch(draft.base+path,{headers:draft.headers});expect(response.status).toBe(200);return response.json();};
        const rows=(price:string)=>[1,2,3].map(index=>({clientRowKey:"a07-generic-"+index,sortOrder:index-1,itemName:"通用核验项00"+index,unit:"项",quantity:String(index),unitPrice:price,taxRatePercent:"0",customData:{}}));
        expect((await saveBody(draft,undefined,"A07通用甲方初始",rows("100.0000"))).status).toBe(200);
        const body=await get("/document-body");expect(body.blocks.find((x:{id:string})=>x.id===manualId)).toMatchObject({editable:true});
        const plan={protocolVersion:1,layoutTemplateVersionId:layout.id,sourceSha256:sourceSha,edits:[{positionId:manualId,text:manualText}],additions:[]};
        const manualSaved=await saveBody(draft,plan,"A07通用甲方初始",rows("100.0000"));expect(manualSaved.status===200?"OK":await manualSaved.text()).toBe("OK");
        const before=await get("/workbench");expect(before.version.amountYuan).toBe("600.0000");expect(before.version.draftData.contractBasics.businessType).toBe("other");
        const changed=await saveBody(draft,before.version.draftData.documentBody,"A07通用同步甲方",rows("120.0000"));expect(changed.status===200?"OK":await changed.text()).toBe("OK");
        const saved=await get("/workbench"), finalBody=await get("/document-body");
        expect(saved.version).toMatchObject({amountYuan:"720.0000",layoutTemplateVersionId:layout.id});
        expect(saved.version.draftData.documentBody).toEqual(before.version.draftData.documentBody);
        expect(finalBody).toMatchObject({sourceSha256:sourceSha,documentContentRevision:saved.version.documentContentRevision,draftRevision:saved.version.draftRevision});
        expect(finalBody.blocks.find((x:{id:string})=>x.id===manualId)).toMatchObject({text:manualText});
        const text=finalBody.blocks.map((x:{text:string})=>x.text).join("");expect(text).toContain("其他合同");expect(text).toContain("签章页");expect(text.match(/A07通用同步甲方/gu)).toHaveLength(2);expect(text).not.toContain("A07通用甲方初始");
        const pricingReadback = finalBody.blocks.find((block: { text: string }) => block.text.startsWith("计价方式："));
        expect(pricingReadback).toMatchObject({ editable: false });
        expect(saved.version).toMatchObject({ pricingNature: "unit_price", invoiceType: null });
        expect(pricingReadback.text).toContain("计价方式：固定单价；发票类型：—；适用税率：0%");
        await writeFile(join(directory, "pricing-first-observation.json"), JSON.stringify({ pricingNature: saved.version.pricingNature, invoiceType: saved.version.invoiceType, paragraph: pricingReadback, scope: "Actual raw first read; missing raw consumers are not qualified by a successful amount sync" }, null, 2));
        const repeat=await get("/workbench");expect(repeat.version).toEqual(saved.version);
        await writeFile(join(directory,"saved-public-facts.json"),JSON.stringify({sourceSha,layout,typeKey:"other",sourcePositions,publicMappingProof,manualId,manualText,before,saved,finalBody,fixtureScope:"Technical synthetic immutable published catalog; no formal adoption or template publication"},null,2));
        Object.defineProperty(server,"store",{get(){throw new Error("准备结束不得私读持久fixture");}});
        return {source,layout,draft,base,saved,finalBody};
      });
      const queued=await phase("public-queue-exact-saved-revision",7000,async()=>{
        const response=await fetch(prepared.draft.base+"/preview-generation",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({sourceRevision:prepared.saved.version.draftRevision})});expect(response.status===201?"OK":await response.text()).toBe("OK");
        const job=await response.json();expect(job).toMatchObject({status:"queued",documentContentRevision:prepared.saved.version.documentContentRevision,documentContentFingerprint:prepared.saved.version.documentContentFingerprint});return job;
      });
      const output=await phase("actual-docx4j-worker",130000,async()=>{
        expect(await server.processor.processNext()).toBe(true);
        const response=await fetch(prepared.base+"/contract-workbench/"+prepared.draft.version.id+"/documents",{headers:prepared.draft.headers});expect(response.status).toBe(200);const list=await response.json();const job=list.find((x:{id:string})=>x.id===queued.generationId);
        await writeFile(join(directory,"worker-public-result.json"),JSON.stringify({queued,job,sourceSha,savedVersion:prepared.saved.version},null,2));
        expect(job).toMatchObject({status:"success",documentContentRevision:prepared.saved.version.documentContentRevision,documentContentFingerprint:prepared.saved.version.documentContentFingerprint,inputSnapshot:{bodyDocument:{sourceSha256:sourceSha,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab",renderSemanticVersion:"contract-money-v1",tableLayoutVersion:"body-bill-loop-v2"}}});
        expect(job.inputSnapshot.bodyDocument.typographyVersion).toBeUndefined();expect(job.inputSnapshot.bodyDocument.signatureDateVersion).toBeUndefined();return job;
      });
      const actual=await phase("public-two-format-download-and-physical",25000,async()=>{
        const files:Partial<Record<"docx"|"pdf",Buffer>>={};
        for(const [format,id]of [["docx",output.docxFileId],["pdf",output.pdfFileId]]as const){const ticket=await fetch(prepared.base+"/files/"+id+"/download-ticket",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({confirmationPassword:server.password,downloadReason:"核对通用同修订Word和PDF",accessMode:format==="pdf"?"preview":"download"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const downloaded=await fetch(prepared.base+value.downloadUrl);expect(downloaded.status).toBe(200);files[format]=Buffer.from(await downloaded.arrayBuffer());await writeFile(join(directory,"actual."+format),files[format]!);}
        const normalization=output.inputSnapshot.inspection.packageMetadataNormalization;
        expect(normalization).toEqual({normalizationId:"generic-font-table-content-type-v1",originalMasterSha256:sourceSha,
          renderedDocxBeforeSha256:expect.stringMatching(/^[a-f0-9]{64}$/u),renderedDocxAfterSha256:hash(files.docx!),changedParts:["[Content_Types].xml"]});
        expect(normalization.renderedDocxBeforeSha256).not.toBe(normalization.renderedDocxAfterSha256);
        const exported=new PizZip(files.docx!), original=new PizZip(prepared.source);
        expect(exported.file("word/fontTable.xml")!.asNodeBuffer()).toEqual(original.file("word/fontTable.xml")!.asNodeBuffer());
        expect(exported.file("word/styles.xml")!.asNodeBuffer()).toEqual(original.file("word/styles.xml")!.asNodeBuffer());
        const originalTypes=new DOMParser().parseFromString(original.file("[Content_Types].xml")!.asText(),"application/xml");
        const exportedTypes=new DOMParser().parseFromString(exported.file("[Content_Types].xml")!.asText(),"application/xml");
        const typeRecords=(document: typeof originalTypes)=>Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types","*")).slice(1).map(node=>({kind:node.localName,part:node.getAttribute("PartName"),extension:node.getAttribute("Extension"),type:node.getAttribute("ContentType")}));
        expect(typeRecords(exportedTypes)).toEqual([...typeRecords(originalTypes),{kind:"Override",part:"/word/fontTable.xml",extension:null,type:"application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"}]);
        const xml=new DOMParser().parseFromString(exported.file("word/document.xml")!.asText(),"application/xml");const wordText=Array.from(xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","t")).map(x=>x.textContent??"").join("");
        const pdfText=inspectActualTemplatePdf(files.docx!,files.pdf!,"A07-exact-generic-saved-revision",output.inputSnapshot.inspection.runtime);
        for(const value of [manualText,"A07通用同步甲方","当前单乙方","其他合同","签章页","通用核验项001","通用核验项003","720.0000"]){expect(wordText).toContain(value);expect(pdfText.replace(/\s/gu,"")).toContain(value.replace(/\s/gu,""));}
        expect(wordText).not.toContain("A07通用甲方初始");
        for (const value of ["计价方式：固定单价", "发票类型：—", "适用税率：0%", "360.0000", "柒佰贰拾元整", "第一条 业务内容", "第五条 合同清单"]) {
          expect(wordText).toContain(value); expect(pdfText.replace(/\s/gu, "")).toContain(value.replace(/\s/gu, ""));
        }
        const main = xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "tbl");
        expect(main.length).toBe(2);
        expect(main[0].getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "tr").length).toBe(4);
        expect(main[0].getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "tblGrid")[0].getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "gridCol").length).toBe(7);
        expect(exported.file("word/footer1.xml")!.asNodeBuffer()).toEqual(original.file("word/footer1.xml")!.asNodeBuffer());
        return {docxSha256:hash(files.docx!),pdfSha256:hash(files.pdf!)};
      });
      await writeFile(join(directory,"verified-receipt.json"),JSON.stringify({sourceSha,typeKey:"other",billKey:"main",declaredLoop:"genericItems",queued,output,actual,verdict:"GREEN_SINGLE_SOURCE_ONLY",caseId:randomUUID(),scope:"One exact generic technical source current product path; not adoption/eight-source completion/whole Task10"},null,2));
      console.info("A07通用首纵向实际证据："+directory);
    }catch(cause){await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("A07通用首纵向失败，证据 "+directory,{cause});}
    finally{await server.processor.onApplicationShutdown();await server.app.close();}
  },190000);
});

describe("task10 A07 exact labor source product tracer", () => {
  it("creates labor type, preserves a manual clause through party and money sync and exports the saved revision in both formats", async () => {
    const started = performance.now();
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-A07-labor-"));
    const phases: Array<Record<string, unknown>> = [];
    async function phase<T>(name: string, limit: number, work: () => Promise<T>) {
      const begin = performance.now(), budget = Math.min(limit, started + 170_000 - begin);
      if (budget <= 0) throw new Error("劳务样张阶段预算耗尽");
      try { const value = await work(); if (performance.now() - begin > budget) throw new Error("劳务样张阶段超预算"); phases.push({name, budgetMs:budget, seconds:(performance.now()-begin)/1000,exit:0}); return value; }
      catch(cause) {phases.push({name,budgetMs:budget,seconds:(performance.now()-begin)/1000,exit:1,message:cause instanceof Error?cause.message:"阶段失败"});throw cause;}
      finally {await writeFile(join(directory,"phases.json"),JSON.stringify(phases,null,2));}
    }
    const server = await createTemplateTestServer({draftWorkbench:true});
    const hash = (bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
    const sourceSha="faae3cebc8e377764df12e999bcfddb1beefe6958cb728175f33f8e6fa4a187f";
    const manualId="f70713aaf3dae733d4250b8530dbaf7f7465db4b4db66bb547afd6e75888c2f6";
    const manualText="具体工作内容、计量单位、数量和单价详见本合同劳务清单。原劳务人工补充约定保留。";
    try {
      const prepared=await phase("public-labor-create-edit-sync",10000,async()=>{
        const source=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/labor-subcontract-real-v1.docx"));expect(hash(source)).toBe(sourceSha);
        const layout=await confirmedBodyLayout(server,source,"laborItems","labor_subcontract","劳务原源临时技术样张",[["contract.pricingNatureLabel",["计价方式"]],["field.invoiceType",["发票类型"]]]);
        const draft=await createTask09Draft(server,"capped","labor_subcontract");
        expect(draft.contract).toMatchObject({contractTypeKey:"labor_subcontract"});
        expect((await saveTask09Draft(server,draft,"labor_subcontract",layout.id)).status).toBe(200);
        const base=await server.app.getUrl();
        const director=await loginTemplateActor(server,"director");
        const positions=await fetch(base+"/contract-layout-template-versions/"+layout.id+"/source-positions",{headers:{authorization:"Bearer "+director}});expect(positions.status).toBe(200);
        const sourcePositions=await positions.json();expect(sourcePositions.sourceSha256).toBe(sourceSha);
        const anchors = sourcePositions.positions.filter((position: { text: string }) => /\{(?:合同名称|合同编号|甲方名称|乙方名称|文档水印)\}/u.test(position.text));
        expect(anchors).toHaveLength(9);
        const priceSource = sourcePositions.positions.find((position: { text: string }) => position.text.startsWith("计价方式："));
        for (const [token, fieldKey] of [["{计价方式}", "contract.pricingNatureLabel"], ["{发票类型}", "field.invoiceType"]]) {
          const start = priceSource.text.indexOf(token);
          expect(sourcePositions.bindings.filter((binding: { fieldKey: string }) => binding.fieldKey === fieldKey)).toEqual([{ positionId: priceSource.positionId, start, end: start + token.length, fieldKey }]);
          expect(sourcePositions.fields.find((field: { key: string }) => field.key === fieldKey)).toMatchObject({ required: false });
        }
        expect(sourcePositions.mappingFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        expect(sourcePositions.confirmed).toBe(true);
        const mappingHeaders = { authorization: "Bearer " + director, "content-type": "application/json" };
        const mappingDraftResponse = await fetch(base + "/contract-layout-templates", { method: "POST", headers: mappingHeaders, body: JSON.stringify({ name: "劳务可选字段公有映射草稿", contractTypeKey: "labor_subcontract", docxFileId: sourcePositions.sourceFileId, placeholderSchema: { bills: [{ key: "laborItems" }] } }) });
        expect(mappingDraftResponse.status === 201 ? "OK" : await mappingDraftResponse.text()).toBe("OK");
        const mappingDraft = await mappingDraftResponse.json();
        const mappingPath = base + "/contract-layout-template-versions/" + mappingDraft.version.id;
        const mappingSavedResponse = await fetch(mappingPath + "/source-mapping", { method: "PATCH", headers: mappingHeaders, body: JSON.stringify({ expectedRevision: 1, sourceFileId: sourcePositions.sourceFileId, sourceSha256: sourceSha, bindings: sourcePositions.bindings }) });
        expect(mappingSavedResponse.status === 200 ? "OK" : await mappingSavedResponse.text()).toBe("OK");
        const mappingSaved = await mappingSavedResponse.json();
        const mappingReadResponse = await fetch(mappingPath + "/source-positions", { headers: mappingHeaders });
        expect(mappingReadResponse.status).toBe(200);
        const publicMappingProof = await mappingReadResponse.json();
        expect(publicMappingProof).toMatchObject({ sourceSha256: sourceSha, sourceFileId: sourcePositions.sourceFileId, draftRevision: 2, mappingFingerprint: mappingSaved.mappingFingerprint, confirmed: false, bindings: sourcePositions.bindings });
        expect(mappingSaved.preview.find((position: { text: string }) => position.text.startsWith("计价方式：")).text).toContain("{contract.pricingNatureLabel}；发票类型：{field.invoiceType}");
        expect(mappingSaved.mappingFingerprint).not.toBe(sourcePositions.mappingFingerprint);
        expect(sourcePositions.positions.find((x:{positionId:string})=>x.positionId===manualId)).toMatchObject({part:"word/document.xml",paragraphIndex:58,text:"具体工作内容、计量单位、数量和单价详见本合同劳务清单。"});
        const get=async(path:string)=>{const response=await fetch(draft.base+path,{headers:draft.headers});expect(response.status).toBe(200);return response.json();};
        const rows=(price:string)=>[1,2,3].map(index=>({clientRowKey:"a07-labor-"+index,sortOrder:index-1,itemName:"劳务核验项00"+index,unit:"项",quantity:String(index),unitPrice:price,taxRatePercent:"0",customData:{}}));
        expect((await saveBody(draft,undefined,"A07劳务甲方初始",rows("100.0000"))).status).toBe(200);
        const body=await get("/document-body");expect(body.blocks.find((x:{id:string})=>x.id===manualId)).toMatchObject({editable:true});
        const plan={protocolVersion:1,layoutTemplateVersionId:layout.id,sourceSha256:sourceSha,edits:[{positionId:manualId,text:manualText}],additions:[]};
        const manualSaved=await saveBody(draft,plan,"A07劳务甲方初始",rows("100.0000"));expect(manualSaved.status===200?"OK":await manualSaved.text()).toBe("OK");
        const before=await get("/workbench");expect(before.version.amountYuan).toBe("600.0000");expect(before.version.draftData.contractBasics.businessType).toBe("labor_subcontract");
        const changed=await saveBody(draft,before.version.draftData.documentBody,"A07劳务同步甲方",rows("120.0000"));expect(changed.status===200?"OK":await changed.text()).toBe("OK");
        const saved=await get("/workbench"), finalBody=await get("/document-body");
        expect(saved.version).toMatchObject({amountYuan:"720.0000",layoutTemplateVersionId:layout.id});
        expect(saved.version.draftData.documentBody).toEqual(before.version.draftData.documentBody);
        expect(saved.version.documentContentRevision).toBeGreaterThan(before.version.documentContentRevision);
        expect(saved.version.documentContentFingerprint).not.toBe(before.version.documentContentFingerprint);
        expect(finalBody).toMatchObject({sourceSha256:sourceSha,documentContentRevision:saved.version.documentContentRevision,draftRevision:saved.version.draftRevision});
        expect(finalBody.blocks.find((x:{id:string})=>x.id===manualId)).toMatchObject({text:manualText});
        const text=finalBody.blocks.map((x:{text:string})=>x.text).join("");expect(text).toContain("劳务分包工程名称");expect(text).toContain("发包人：(盖章)");expect(text.match(/A07劳务同步甲方/gu)).toHaveLength(2);expect(text).not.toContain("A07劳务甲方初始");
        const pricingReadback = finalBody.blocks.find((block: { text: string }) => block.text.startsWith("计价方式："));
        expect(pricingReadback).toMatchObject({ editable: false });
        expect(saved.version).toMatchObject({ pricingNature: "unit_price", invoiceType: null });
        expect(pricingReadback.text).toContain("计价方式：固定单价；发票类型：—；适用税率：0%");
        await writeFile(join(directory, "pricing-mapping-readback.json"), JSON.stringify({ pricingNature: saved.version.pricingNature, invoiceType: saved.version.invoiceType, paragraph: pricingReadback, scope: "Actual saved-version pricing read after explicit canonical mapping; not a raw/unmapped observation" }, null, 2));
        const repeat=await get("/workbench");expect(repeat.version).toEqual(saved.version);
        await writeFile(join(directory,"saved-public-facts.json"),JSON.stringify({sourceSha,layout,typeKey:"labor_subcontract",sourcePositions,publicMappingProof,manualId,manualText,before,saved,finalBody,fixtureScope:"Technical synthetic immutable published catalog; no formal adoption or template publication"},null,2));
        Object.defineProperty(server,"store",{get(){throw new Error("准备结束不得私读持久fixture");}});
        return {source,layout,draft,base,saved,finalBody};
      });
      const queued=await phase("public-queue-exact-saved-revision",7000,async()=>{
        const response=await fetch(prepared.draft.base+"/preview-generation",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({sourceRevision:prepared.saved.version.draftRevision})});expect(response.status===201?"OK":await response.text()).toBe("OK");
        const job=await response.json();expect(job).toMatchObject({status:"queued",documentContentRevision:prepared.saved.version.documentContentRevision,documentContentFingerprint:prepared.saved.version.documentContentFingerprint});return job;
      });
      const output=await phase("actual-docx4j-worker",130000,async()=>{
        expect(await server.processor.processNext()).toBe(true);
        const response=await fetch(prepared.base+"/contract-workbench/"+prepared.draft.version.id+"/documents",{headers:prepared.draft.headers});expect(response.status).toBe(200);const list=await response.json();const job=list.find((x:{id:string})=>x.id===queued.generationId);
        await writeFile(join(directory,"worker-public-result.json"),JSON.stringify({queued,job,sourceSha,savedVersion:prepared.saved.version},null,2));
        expect(job).toMatchObject({status:"success",documentContentRevision:prepared.saved.version.documentContentRevision,documentContentFingerprint:prepared.saved.version.documentContentFingerprint,inputSnapshot:{bodyDocument:{sourceSha256:sourceSha,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab",renderSemanticVersion:"contract-money-v1",tableLayoutVersion:"body-bill-loop-v2"}}});
        expect(job.inputSnapshot.bodyDocument.typographyVersion).toBeUndefined();expect(job.inputSnapshot.bodyDocument.signatureDateVersion).toBeUndefined();return job;
      });
      const actual=await phase("public-two-format-download-and-physical",25000,async()=>{
        const files:Partial<Record<"docx"|"pdf",Buffer>>={};
        for(const [format,id]of [["docx",output.docxFileId],["pdf",output.pdfFileId]]as const){const ticket=await fetch(prepared.base+"/files/"+id+"/download-ticket",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({confirmationPassword:server.password,downloadReason:"核对劳务同修订Word和PDF",accessMode:format==="pdf"?"preview":"download"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const downloaded=await fetch(prepared.base+value.downloadUrl);expect(downloaded.status).toBe(200);files[format]=Buffer.from(await downloaded.arrayBuffer());await writeFile(join(directory,"actual."+format),files[format]!);}
        expect(output.inputSnapshot.inspection.packageMetadataNormalization).toBeUndefined();
        const exported=new PizZip(files.docx!), original=new PizZip(prepared.source);
        for (const part of ["[Content_Types].xml", "word/fontTable.xml", "word/styles.xml"]) expect(exported.file(part)!.asNodeBuffer()).toEqual(original.file(part)!.asNodeBuffer());
        const xml=new DOMParser().parseFromString(exported.file("word/document.xml")!.asText(),"application/xml");const wordText=Array.from(xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","t")).map(x=>x.textContent??"").join("");
        const pdfText=inspectActualTemplatePdf(files.docx!,files.pdf!,"A07-exact-labor-saved-revision",output.inputSnapshot.inspection.runtime);
        for(const value of [manualText,"A07劳务同步甲方","当前单乙方","劳务分包工程名称","发包人：(盖章)","劳务核验项001","劳务核验项003","720.0000"]){expect(wordText).toContain(value);expect(pdfText.replace(/\s/gu,"")).toContain(value.replace(/\s/gu,""));}
        expect(wordText).not.toContain("A07劳务甲方初始");
        for (const value of ["计价方式：固定单价", "发票类型：—", "适用税率：0%", "360.0000", "柒佰贰拾元整", "公司审批后方可生效，否则不予作为最终结算依据。", "所有工序、工艺，若乙方报价", "向甲方汇报，48小时"]) {
          expect(wordText).toContain(value); expect(pdfText.replace(/\s/gu, "")).toContain(value.replace(/\s/gu, ""));
        }
        const main = xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "tbl");
        expect(main.length).toBe(3);
        expect(main[2].getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "tr").length).toBe(4);
        expect(main[2].getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "tblGrid")[0].getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "gridCol").length).toBe(7);
        expect(exported.file("word/footer1.xml")!.asNodeBuffer()).toEqual(original.file("word/footer1.xml")!.asNodeBuffer());
        return {docxSha256:hash(files.docx!),pdfSha256:hash(files.pdf!)};
      });
      await writeFile(join(directory,"verified-receipt.json"),JSON.stringify({sourceSha,typeKey:"labor_subcontract",billKey:"main",declaredLoop:"laborItems",queued,output,actual,verdict:"GREEN_SINGLE_SOURCE_ONLY",caseId:randomUUID(),scope:"One exact labor technical source current product path; not adoption/eight-source completion/whole Task10"},null,2));
      console.info("A07劳务首纵向实际证据："+directory);
    }catch(cause){await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("A07劳务首纵向失败，证据 "+directory,{cause});}
    finally{await server.processor.onApplicationShutdown();await server.app.close();}
  },190000);
});

describe("Task10 confirmed material transport unified native version", () => {
  it("publishes the inspected unified version and exports 45 materials plus nonzero transport at the saved revision", async () => {
    const begin = performance.now(), directory = await mkdtemp(join(tmpdir(), "jg-task10-material-unified-native-"));
    const phases: Array<Record<string, unknown>> = [];
    const priorFontconfig = process.env.FONTCONFIG_FILE;
    async function phase<T>(name: string, limit: number, work: () => Promise<T>) {
      const start = performance.now(), remaining = Math.min(limit, 170000 - (start - begin));
      if (remaining <= 0) throw new Error("统一清单阶段预算已用尽");
      try { const result = await work(); if (performance.now() - start > remaining) throw new Error("统一清单阶段超时：" + name); phases.push({ name, passed: true, seconds: (performance.now() - start) / 1000, budgetMs: remaining }); return result; }
      catch (cause) { phases.push({ name, passed: false, seconds: (performance.now() - start) / 1000, budgetMs: remaining }); throw cause; }
      finally { await writeFile(join(directory, "phases.json"), JSON.stringify(phases, null, 2)); }
    }
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
    const sourceSha = "3fcd682276933ccf69014ac30ddcb32e7e15322a3c433e19db437478fac95722";
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-unified-v2.docx")); expect(hash(source)).toBe(sourceSha);
      const master = await readFile(resolve(__dirname, "../../../../scripts/probes/task08-documents/samples/material-purchase-real-v1.docx")); expect(hash(master)).toBe("8d707f8ecd65e2ca69c6920991dcb542cbc23ada42cf39a62299ab25e5820334");
      const original = new PizZip(master), selected = new PizZip(source);
      expect(Object.values(selected.files).filter(file => !file.dir && !file.asNodeBuffer().equals(original.file(file.name)!.asNodeBuffer())).map(file => file.name).sort()).toEqual(["word/document.xml", "word/footer1.xml", "word/footer2.xml"]);
      const base = await server.app.getUrl(), token = await loginTemplateActor(server, "director"), headers = { authorization: "Bearer " + token, "content-type": "application/json" };
      const request = (path: string, method = "GET", value?: unknown) => fetch(base + path, { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
      const layout = await phase("public-new-template-map-and-inspect", 15000, async () => {
        const form = new FormData(); form.append("file", new Blob([new Uint8Array(source)]), "材料与运输统一清单新版.docx");
        const uploaded = await fetch(base + "/files", { method: "POST", headers: { authorization: headers.authorization }, body: form }); expect(uploaded.status).toBe(201); const file = await uploaded.json();
        const created = await request("/contract-layout-templates", "POST", { name: "材料与运输统一清单技术验证新版", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [{ key: "materials" }] } }); expect(created.status).toBe(201); const result = await created.json(); const path = "/contract-layout-template-versions/" + result.version.id;
        const read = await request(path + "/source-positions"); expect(read.status).toBe(200); const positions = await read.json(); expect(positions.sourceSha256).toBe(sourceSha);
        const fields = [["contract.name", ["合同名称"]], ["party.owner.name", ["甲方名称"]], ["party.counterparty.name", ["乙方名称"]], ["contract.temporaryCode", ["合同编号"]], ["document.watermark", ["文档水印"]], ["contract.taxExclusiveAmount", ["材料不含税合计", "不含税总额"]], ["contract.taxExclusiveAmountUppercase", ["不含税总额大写"]], ["contract.taxAmount", ["材料税额合计", "税额总计"]], ["contract.taxAmountUppercase", ["税额总计大写"]], ["contract.amount", ["材料含税合计"]], ["field.invoiceType", ["发票类型"]]] as const;
        const bindings = positions.positions.flatMap((position: { positionId: string; text: string }) => fields.flatMap(([fieldKey, names]) => names.flatMap(name => { const literal = `{${name}}`, start = position.text.indexOf(literal); return start < 0 ? [] : [{ positionId: position.positionId, start, end: start + literal.length, fieldKey }]; })));
        const response = await request(path + "/source-mapping", "PATCH", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: sourceSha, bindings }); expect(response.status).toBe(200); const mapping = await response.json();
        const inspected = await request(path + "/inspection", "POST"); expect(inspected.status).toBe(201); const report = await inspected.json(); expect(report.blockingErrors).toEqual([]);
        const queued = await request(path + "/preview-generation", "POST", { contract: { name: "统一清单纯样张", temporaryCode: "UNIFIED-SAMPLE", amount: "113.0000", taxExclusiveAmount: "100.0000", taxAmount: "13.0000", taxExclusiveAmountUppercase: "壹佰元整", taxAmountUppercase: "壹拾叁元整" }, party: { owner: { name: "样张甲方" }, counterparty: { name: "样张乙方" } }, document: { watermark: "样张" }, bill: { materials: [{ rowNumber: "1", itemName: "样张材料", specification: "样张规格", manufacturer: "样张厂家", unit: "件", quantity: "1", taxExclusiveUnitPrice: "100.0000", taxExclusiveAmount: "100.0000", taxRatePercent: "13%", taxUnitPrice: "13.0000", taxAmount: "13.0000", taxInclusiveUnitPrice: "113.0000", taxInclusiveAmount: "113.0000" }] } }); expect(queued.status).toBe(201); const preview = await queued.json();
        await writeFile(join(directory, "public-template-before-preview.json"), JSON.stringify({ result, file, positions, bindings, mapping, report, preview, sourceSha, sampleIsNotBusinessFacts: true }, null, 2));
        return { result, file, path, mapping, preview };
      });
      const published = await phase("actual-layout-preview-confirm-submit-publish", 130000, async () => {
        expect(await server.processor.processNext()).toBe(true);
        const read = await request(layout.path + "/preview-generation"); expect(read.status).toBe(200); const preview = await read.json();
        await writeFile(join(directory, "public-template-preview-result.json"), JSON.stringify(preview, null, 2)); expect(preview).toMatchObject({ id: layout.preview.id, status: "succeeded", sourceRevision: layout.mapping.draftRevision, previewPdfFileId: expect.any(String) });
        const confirm = await request(layout.path + "/source-mapping-confirmation", "POST", { expectedRevision: layout.mapping.draftRevision, sourceFileId: layout.file.id, sourceSha256: sourceSha, mappingFingerprint: layout.mapping.mappingFingerprint }); expect(confirm.status).toBe(201);
        const submit = await request(layout.path + "/submission", "POST"); expect(submit.status).toBe(201);
        const publish = await request(layout.path + "/publication", "POST", { changeSummary: "本地技术验证：统一材料和运输main清单新源，保留原8d7，不作为生产正式采用" }); expect(publish.status).toBe(201); const result = await publish.json(); expect(result).toMatchObject({ id: layout.result.version.id, status: "published", docxFileId: layout.file.id, draftRevision: layout.mapping.draftRevision });
        await writeFile(join(directory, "public-template-publication.json"), JSON.stringify({ preview, confirmation: await confirm.json(), result, noProductionAdoption: true }, null, 2)); return result;
      });
      delete process.env.FONTCONFIG_FILE;
      phases.push({ name: "switch-owned-LO-preview-to-locked-docx4j-contract", fontconfigRemoved: true, priorFontconfig, qualifiedContractRuntime: "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab" });
      const prepared = await phase("public-46-row-save-edit-and-authority-sync", 15000, async () => {
        const draft = await createTask09Draft(server); const get = (suffix: string) => fetch(draft.base + suffix, { headers: draft.headers }).then(response => { expect(response.status).toBe(200); return response.json(); });
        const materials = Array.from({ length: 45 }, (_, i) => ({ clientRowKey: "material-" + (i + 1), sortOrder: i, itemCode: "M" + String(i + 1).padStart(3, "0"), itemName: "统一材料" + String(i + 1).padStart(3, "0"), specification: "规格" + (i + 1), unit: "件", quantity: String(i + 1), unitPrice: "113", taxRatePercent: "13", customData: { manufacturer: "合成厂家" + (i + 1), rowNumber: "999", taxUnitPrice: "8888.0000" } }));
        const transport = { clientRowKey: "transport-46", sortOrder: 45, itemCode: "T046", itemName: "统一运输046", specification: "合成路线A至项目，车型X", unit: "趟", quantity: "2", unitPrice: "56.5", taxRatePercent: "13", customData: { manufacturer: "不适用", ordinaryExtra: "运输独立列示，不重复收费", rowNumber: "998", taxUnitPrice: "8887.0000" } };
        async function save(rows: Array<Record<string, unknown>>, party: string, plan?: unknown) {
          const current = await get("/workbench");
          const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({ idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties"], draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData, contractName: "材料与运输统一清单合同", ...(plan === undefined ? {} : { documentBody: plan }) }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: published.id, taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" } }, parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: party } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "统一清单合成乙方" } }], bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } }) });
          const data = await response.json(); await writeFile(join(directory, "last-public-save.json"), JSON.stringify({ status: response.status, data }, null, 2)); expect(response.status).toBe(200);
        }
        await save([...materials, transport], "统一清单甲方初始"); const initial = await get("/workbench"); expect(initial.version.amountYuan).toBe("117068.0000");
        const initialBody = await get("/document-body"), ordinary = initialBody.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("1.交货方式：")); expect(ordinary).toBeDefined();
        const manualText = "1.交货方式：材料运至统一仓库，分项运输费用以统一清单为准。";
        const plan = { protocolVersion: 1, layoutTemplateVersionId: published.id, sourceSha256: sourceSha, edits: [{ positionId: ordinary.id, text: manualText }] };
        await save([...materials, transport], "统一清单甲方初始", plan); const beforeSync = await get("/workbench");
        await save([...materials, { ...transport, unitPrice: "113" }], "统一清单同步甲方", plan); const saved = await get("/workbench"), body = await get("/document-body");
        expect(saved.version.amountYuan).toBe("117181.0000"); expect(saved.version.draftData.documentBody).toEqual(beforeSync.version.draftData.documentBody); expect(saved.bills).toHaveLength(1); expect(saved.bills[0]).toMatchObject({ billKey: "main" }); expect(saved.bills[0].rows).toHaveLength(46);
        expect(saved.bills[0].rows[44]).toMatchObject({ quantity: "45", taxInclusiveAmountYuan: "5085.0000", taxExclusiveAmountYuan: "4500.0000", taxAmountYuan: "585.0000" });
        expect(saved.bills[0].rows[45]).toMatchObject({ quantity: "2", taxInclusiveAmountYuan: "226.0000", taxExclusiveAmountYuan: "200.0000", taxAmountYuan: "26.0000" });
        expect(body).toMatchObject({ sourceSha256: sourceSha, documentContentRevision: saved.version.documentContentRevision, draftRevision: saved.version.draftRevision }); expect(body.blocks.find((block: { id: string }) => block.id === ordinary.id)).toMatchObject({ text: manualText }); expect((await get("/workbench")).version).toEqual(saved.version);
        await writeFile(join(directory, "public-saved-facts.json"), JSON.stringify({ draft, initial, beforeSync, saved, body, plan, manualText, sourceSha }, null, 2)); Object.defineProperty(server, "store", { get() { throw new Error("准备后不得私读fixture"); } });
        return { draft, saved, body, plan, manualText };
      });
      const output = await phase("public-exact-revision-queue-and-actual-worker", 130000, async () => {
        const response = await fetch(prepared.draft.base + "/preview-generation", { method: "POST", headers: prepared.draft.headers, body: JSON.stringify({ sourceRevision: prepared.saved.version.draftRevision }) }); expect(response.status).toBe(201); const queued = await response.json();
        expect(queued).toMatchObject({ documentContentRevision: prepared.saved.version.documentContentRevision, documentContentFingerprint: prepared.saved.version.documentContentFingerprint }); expect(await server.processor.processNext()).toBe(true);
        const listed = await fetch(base + "/contract-workbench/" + prepared.draft.version.id + "/documents", { headers: prepared.draft.headers }); expect(listed.status).toBe(200); const job = (await listed.json()).find((item: { id: string }) => item.id === queued.generationId);
        await writeFile(join(directory, "public-generation.json"), JSON.stringify({ queued, job }, null, 2)); expect(job).toMatchObject({ status: "success", documentContentRevision: queued.documentContentRevision, documentContentFingerprint: queued.documentContentFingerprint }); expect(job.inputSnapshot.bodyDocument.sourceSha256).toBe(sourceSha); expect(job.inputSnapshot.bodyDocument.runtimeLockSha256).toBe("95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab");
        expect(job.inputSnapshot.renderInput.values["contract.taxExclusiveAmount"]).toBe("103700.0000"); expect(job.inputSnapshot.renderInput.values["contract.taxAmount"]).toBe("13481.0000"); expect(job.inputSnapshot.renderInput.values["bill.materials"][45]).toMatchObject({ rowNumber: "46", taxUnitPrice: "13.0000", manufacturer: "不适用", ordinaryExtra: "运输独立列示，不重复收费" }); return job;
      });
      await phase("authorized-two-formats-and-physical-observation", 25000, async () => {
        const pair: Partial<Record<"docx" | "pdf", Buffer>> = {};
        for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
          const ticket = await fetch(base + "/files/" + id + "/download-ticket", { method: "POST", headers: prepared.draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对统一材料及运输46行同修订Word和PDF" }) }); expect(ticket.status).toBe(201); const value = await ticket.json(); const read = await fetch(base + value.downloadUrl); expect(read.status).toBe(200); pair[format] = Buffer.from(await read.arrayBuffer()); await writeFile(join(directory, "actual." + format), pair[format]!);
        }
        const exported = new PizZip(pair.docx!); for (const part of ["word/styles.xml", "word/fontTable.xml", "word/settings.xml", "word/footer1.xml", "word/footer2.xml"]) expect(exported.file(part)!.asNodeBuffer()).toEqual(selected.file(part)!.asNodeBuffer());
        const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", word = new DOMParser().parseFromString(exported.file("word/document.xml")!.asText(), "application/xml");
        const tables = Array.from(word.getElementsByTagNameNS(ns, "tbl")); expect(tables).toHaveLength(2); expect(tables[0].getElementsByTagNameNS(ns, "gridCol").length).toBe(13); const tableRows = Array.from(tables[0].getElementsByTagNameNS(ns, "tr")); expect(tableRows).toHaveLength(49);
        const textOf = (node: typeof word | (typeof tables)[number]) => Array.from(node.getElementsByTagNameNS(ns, "t")).map(item => item.textContent ?? "").join(""); const wordText = textOf(word);
        // Use the unchanged public inspector with an explicit child environment.
        // Jest's process.env copy does not control spawnSync's inherited native env.
        const { realpath } = await import("node:fs/promises");
        const { relative, isAbsolute, dirname } = await import("node:path");
        const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON, manifestPath = process.env.TEMPLATE_PDF_RUNTIME_MANIFEST;
        if (!python || !manifestPath) throw new Error("统一清单物理检查需要已锁定检查器及运行清单");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const workspace = await realpath(manifest.workspace), artifacts = await realpath(manifest.artifactDirectory);
        const below = (parent: string, child: string) => { const path = relative(parent, child); return Boolean(path) && !path.startsWith("..") && !isAbsolute(path); };
        const temporaryRoots = [await realpath(tmpdir()), await realpath("/tmp")];
        if (!temporaryRoots.some(root => below(root, workspace)) || !below(workspace, artifacts) || dirname(await realpath(manifestPath)) !== workspace) throw new Error("物理检查目录不在自有隔离运行目录内");
        const physicalDirectory = await mkdtemp(join(artifacts, "physical-unified-"));
        await writeFile(join(physicalDirectory, "source.docx"), pair.docx!); await writeFile(join(physicalDirectory, "actual.pdf"), pair.pdf!);
        await writeFile(join(physicalDirectory, "runtime-witness.json"), JSON.stringify(output.inputSnapshot.inspection.runtime));
        const inspectionEnv = { PATH: "/usr/bin:/bin", HOME: "/Users/leoyang", LANG: "C", LC_ALL: "C", TZ: "Asia/Shanghai", TEMPLATE_PDF_RUNTIME_MODE: "font-profile", PYTHONDONTWRITEBYTECODE: "1" };
        const arguments_ = [resolve(__dirname, "../../test-support/inspect-contract-pdf-physical.py"), join(physicalDirectory, "source.docx"), join(physicalDirectory, "actual.pdf"), join(physicalDirectory, "receipt.json"), manifestPath, join(physicalDirectory, "runtime-witness.json")];
        const inspected = await promisify(execFile)(python, arguments_, { env: inspectionEnv, encoding: "utf8", timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
        await writeFile(join(physicalDirectory, "inspection.log"), inspected.stdout + inspected.stderr);
        const semanticText = inspected.stdout.split("---SEMANTIC-TEXT---\n")[1]; if (semanticText === undefined) throw new Error("物理检查器未返回语义文本");
        const pdfText = semanticText.replace(/\s/gu, "");
        const totals = await promisify(execFile)(python, [resolve(__dirname, "../../test-support/inspect-unified-material-total-lines.py"), join(directory, "actual.pdf"), join(directory, "totals-line-receipt.json"), "103700.0000", "13481.0000", "117181.0000"], { env: inspectionEnv, encoding: "utf8", timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
        await writeFile(join(directory, "physical-cli.json"), JSON.stringify({ python, arguments: arguments_, environmentExactly: inspectionEnv, exitCode: 0, originalStrictReceipt: join(physicalDirectory, "receipt.json"), totals: JSON.parse(totals.stdout), scope: "Original strict inspector unchanged; extra total-row physical line assertion" }, null, 2));
        for (const value of [prepared.manualText, "统一清单同步甲方", "统一清单合成乙方", "统一材料001", "统一材料045", "统一运输046", "117181.0000", "103700.0000", "13481.0000", "5085.0000", "226.0000", "同一运输费用不得重复计入材料行单价或另行收取", "买方（章）", "卖方（章）"]) { expect(wordText).toContain(value); expect(pdfText).toContain(value.replace(/\s/gu, "")); }
        expect(wordText).not.toContain("统一清单甲方初始"); expect(wordText).not.toContain("8888.0000");
        const totalCells = Array.from(tableRows[48].getElementsByTagNameNS(ns, "tc"));
        expect(totalCells.map(cell => Number(cell.getElementsByTagNameNS(ns, "gridSpan")[0]?.getAttributeNS(ns, "val") ?? "1"))).toEqual([5, 1, 2, 1, 2, 2]);
        expect(totalCells.map(cell => textOf(cell))).toEqual(["清单合计（含运输）", "", "103700.0000", "", "13481.0000", "117181.0000"]);
        const materialTail = textOf(tableRows[46]), transportTail = textOf(tableRows[47]); expect(materialTail).toContain("统一材料045"); expect(materialTail).toContain("4500.0000"); expect(materialTail).toContain("585.0000"); expect(transportTail).toContain("统一运输046"); expect(transportTail).toContain("200.0000"); expect(transportTail).toContain("26.0000");
        await writeFile(join(directory, "physical-observation.json"), JSON.stringify({ docxSha256: hash(pair.docx!), pdfSha256: hash(pair.pdf!), wordRows: tableRows.length, columns: 13, footerProgramsFromNewSource: true, originalFloatingBboxEquivalence: "UNPROVEN", pagePaintRequiresIndependentObservation: true, scope: "True public template publication and contract same-revision dual-format output in owned synthetic server; not production adoption" }, null, 2));
      });
      console.info("材料运输统一新版本首实物：" + directory);
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause instanceof Error ? cause.stack : cause)); throw new Error("统一材料运输首纵向失败，证据 " + directory, { cause }); }
    finally { if (priorFontconfig === undefined) delete process.env.FONTCONFIG_FILE; else process.env.FONTCONFIG_FILE = priorFontconfig; await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 210000);
});
