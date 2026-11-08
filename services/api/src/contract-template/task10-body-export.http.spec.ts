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
