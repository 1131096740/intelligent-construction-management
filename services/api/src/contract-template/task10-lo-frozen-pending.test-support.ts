import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { confirmedBodyLayout } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
function fixtureSource(kind: "legacy" | "offline") {
  const zip = new PizZip(syntheticWordSource(true));
  const xml = zip.file("word/document.xml")!.asText();
  zip.file("word/document.xml", xml.replace("<w:sectPr>", '<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312"/><w:sz w:val="28"/></w:rPr><w:t>' + (kind === "legacy" ? "历史待处理生成独立核验" : "用户线下修订独立核验") + '</w:t></w:r></w:p><w:sectPr>'));
  for (const file of Object.values(zip.files)) file.date = new Date("2020-01-01T00:00:00Z");
  return zip.generate({ type: "nodebuffer" });
}

/** Explicit historical pending-state arrangement, followed only by public reads,
 * actual worker and authorized downloads. Never represents a new retired POST. */
export async function runFrozenPendingLoCase(kind: "legacy" | "offline") {
  const started = performance.now(), phases: Array<Record<string, unknown>> = [];
  const repository = await realpath(resolve(__dirname, "../../../.."));
  if (repository !== "/private/tmp/jg-382-task10-material-unified-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("只允许准确任务10隔离API目录");
  const expectation = process.env.TASK10_LO_PENDING_EXPECT;
  if (!["observe", "failed", "trusted"].includes(expectation ?? "")) throw new Error("必须明确历史任务字体观测模式");
  const manifest = JSON.parse(await readFile(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST!, "utf8")) as { fontconfig: {path: string; sha256: string}; converter: {native: {path: string; sha256: string}; wrapper: {path: string; sha256: string}}; fonts: Array<{path: string; sha256: string}> };
  expect(manifest.converter.native.sha256).toBe("1d91ffe5137be070d15a9c1a8f6ec780314791732108bdcd94c440aed7be5fc6");
  expect(process.env.FONTCONFIG_FILE).toBe(manifest.fontconfig.path); expect(process.env.DOC_CONVERTER_COMMAND).toBeUndefined();
  for (const entry of [manifest.fontconfig, manifest.converter.native, manifest.converter.wrapper, ...manifest.fonts]) expect(sha(await readFile(entry.path))).toBe(entry.sha256);
  const directory = await mkdtemp(join(tmpdir(), "jg-task10-B-" + kind + "-"));
  async function phase<T>(name: string, limit: number, work: () => Promise<T>, deadline = started + 170000) {
    const begin = performance.now(), budget = Math.min(limit, deadline - begin);
    if (budget <= 0) throw new Error("历史字体观测阶段预算耗尽");
    try { const result = await work(); if (performance.now() - begin > budget) throw new Error("历史字体观测阶段超预算"); phases.push({name, budget, seconds: (performance.now()-begin)/1000, exit:0}); return result; }
    catch (cause) { phases.push({name, budget, seconds: (performance.now()-begin)/1000, exit:1, message: cause instanceof Error ? cause.message : "阶段失败"}); throw cause; }
    finally { await writeFile(join(directory,"phases.json"),JSON.stringify(phases,null,2)); }
  }
  let server: Awaited<ReturnType<typeof createTemplateTestServer>> | undefined;
  try {
    const prepared = await phase("historical-arrangement-and-public-facts",10000,async()=>{
      server = await createTemplateTestServer({draftWorkbench:true,realNegotiationReads:true});
      const source = fixtureSource("legacy"), revision = fixtureSource("offline");
      await writeFile(join(directory,"template.docx"),source); await writeFile(join(directory,"revision.docx"),revision);
      const layout=await confirmedBodyLayout(server,source,undefined,"material_purchase","历史LO独立源");
      const draft=await createTask09Draft(server);expect((await saveTask09Draft(server,draft,"material_purchase",layout.id)).status).toBe(200);
      const get = async(path:string)=>{const response=await fetch((await server!.app.getUrl())+path,{headers:draft.headers});expect(response.status).toBe(200);return response.json();};
      const wb = await get("/contract-drafts/"+draft.version.id+"/workbench");
      const stored=await server.store.prisma.contractLayoutTemplateVersion.findUnique({where:{id:layout.id}});
      const frozen={documentContentRevision:wb.version.documentContentRevision,documentContentFingerprint:wb.version.documentContentFingerprint,templateFileId:stored!.docxFileId,layoutSourceMapping:(stored!.placeholderSchema as {sourceMapping:unknown}).sourceMapping,outputBaseName:"历史LO字体核验",renderInput:{values:{"contract.name":"历史冻结中文合同","contract.temporaryCode":wb.contract.temporaryCode,"party.owner.name":"历史中文甲方","party.counterparty.name":"历史中文乙方","document.watermark":"草稿"}},requiredKeys:[],attachmentFiles:[]};
      const key=sha(JSON.stringify([draft.version.id,wb.version.documentContentRevision,wb.version.documentContentFingerprint,layout.id,"draft",[]]));
      const legacy=await server.store.prisma.contractGeneratedDocument.create({data:{contractVersionId:draft.version.id,layoutTemplateVersionId:layout.id,purpose:"draft",status:kind==="legacy"?"queued":"success",sourceRevision:wb.version.draftRevision,idempotencyKey:key,engineVersion:"contract-document-v1",inputSnapshot:frozen,createdByUserId:"staff",...(kind==="offline"?{docxFileId:stored!.docxFileId,completedAt:new Date()}: {})}});
      let jobId=legacy.id;
      let inputFileId:string|undefined;
      if(kind==="offline") {
        const base=await server.app.getUrl();
        const form=new FormData();form.append("file",new Blob([new Uint8Array(revision)],{type:DOCX}),"用户线下修订.docx");
        const upload=await fetch(base+"/files",{method:"POST",headers:{authorization:draft.headers.authorization},body:form});expect(upload.status).toBe(201);inputFileId=(await upload.json()).id;
        const round=await server.store.prisma.contractNegotiationRound.create({data:{contractVersionId:draft.version.id,roundNo:1,status:"open",sourceGeneratedDocumentId:legacy.id,sourceRevision:wb.version.draftRevision}});
        const pending=await server.store.prisma.contractOfflineRevision.create({data:{contractVersionId:draft.version.id,negotiationRoundId:round.id,sourceGeneratedDocumentId:legacy.id,sourceRevision:wb.version.draftRevision,fileId:inputFileId,label:"合成既存历史待处理线下稿",status:"queued",previewPdfFileId:null,confirmedByUserId:"staff",confirmationStatement:"合成历史已确认原件",note:null}});jobId=pending.id;
        await server.store.prisma.contractDocumentComparison.create({data:{negotiationRoundId:round.id,offlineRevisionId:pending.id,sourceRevision:wb.version.draftRevision,status:"queued"}});
        const oldMode=process.env.CONTRACT_CUTOVER_MODE, tombstones: unknown[]=[];
        try {
          for(const mode of ["release-a","release-b-maintenance"]) {
            process.env.CONTRACT_CUTOVER_MODE=mode;
            for(const path of ["/contract-workbench/"+draft.version.id+"/negotiation-rounds","/contract-workbench/"+draft.version.id+"/offline-revisions","/contract-offline-revisions/"+jobId+"/retry","/contract-offline-revisions/"+jobId+"/preview-download-ticket"]) {
              const response=await fetch(base+path,{method:"POST",headers:draft.headers,body:JSON.stringify({fileId:inputFileId,confirmationStatementAccepted:true,confirmationPassword:server.password,downloadReason:"核对退役入口仍关闭"})});const body=await response.json();expect(response.status).toBe(410);expect(body).toMatchObject({code:"OLD_WRITE_ENTRY_RETIRED"});tombstones.push({mode,path,status:response.status,body});
            }
          }
        } finally {if(oldMode===undefined)delete process.env.CONTRACT_CUTOVER_MODE;else process.env.CONTRACT_CUTOVER_MODE=oldMode;}
        await writeFile(join(directory,"public-retired-tombstones.json"),JSON.stringify(tombstones,null,2));
      }
      const path="/contract-workbench/"+draft.version.id+(kind==="legacy"?"/documents":"/offline-revisions");
      const before=await get(path);expect(before.find((item:{id:string})=>item.id===jobId)).toMatchObject({id:jobId,status:"queued"});
      const sourceFact=(await get("/contract-workbench/"+draft.version.id+"/documents")).find((item:{id:string})=>item.id===legacy.id);expect(sourceFact.inputSnapshot).toEqual(frozen);expect(sourceFact.engineVersion).toBe("contract-document-v1");
      const repeat=await get(path);expect(repeat).toEqual(before);
      await writeFile(join(directory,"fixture-facts.json"),JSON.stringify({kind,sourceSha256:sha(source),revisionSha256:sha(revision),legacy:sourceFact,jobId,inputFileId,publicBefore:before,owner:wb.version,statement:"Synthetic existing historical pending facts; no current retired POST creates these records; public original user upload excluded from worker outputs; all retired routes remain 410"},null,2));
      Object.defineProperty(server,"store",{get(){throw new Error("历史准备窗口结束，不得私读store");}});
      return {draft,get,path,jobId,inputFileId,source,revision,legacy,frozen,sourceFact,publicBefore:before,ownerBefore:wb.version};
    });
    const uploads=jest.spyOn(server!.files,"uploadPrivateFile"), audits=jest.spyOn(server!.moduleRef.get(AuditService),"record");
    const after=await phase("actual-pending-worker",130000,async()=>{expect(await server!.processor.processNext()).toBe(true);return prepared.get(prepared.path);});
    const job=after.find((item:{id:string})=>item.id===prepared.jobId);
    if(kind==="legacy")expect(job.inputSnapshot).toEqual(job.status==="success" ? {...prepared.frozen,inspection:{pageCount:1,pageSizes:["A4_portrait"],warnings:[]}} : prepared.frozen);
    const outputCalls=await Promise.all(uploads.mock.calls.map(async(call,index)=>({name:call[0].originalName,mime:call[0].mimeType,sha256:sha(call[0].buffer),fileId:(await uploads.mock.results[index].value).id})));
    for (const [index, call] of uploads.mock.calls.entries()) await writeFile(join(directory, "worker-output-"+index+(call[0].mimeType==="application/pdf"?".pdf":".docx")),call[0].buffer);
    const jobAudits=audits.mock.calls.map(call=>call[1]).filter(event=>event.businessId===prepared.jobId);
    await writeFile(join(directory,"worker-observation.json"),JSON.stringify({job,publicAfter:after,outputCalls,jobAudits,native:manifest.converter.native,expectation},null,2));
    if(expectation==="failed") {
      expect(job).toMatchObject({status:"failed"});expect(uploads).toHaveBeenCalledTimes(0);
      if(kind==="legacy") {expect(job.docxFileId).toBeNull();expect(job.pdfFileId).toBeNull();expect(jobAudits.filter(x=>x.action==="contract.document.failure")).toHaveLength(1);}
      else {expect(job.hasPreviewPdf).toBe(false);expect(job.comparison.status).toBe("failed");expect(jobAudits.filter(x=>x.action==="contract.offline_revision.process_failure")).toHaveLength(1);}
      expect(jobAudits.filter(x=>x.action.endsWith("success"))).toHaveLength(0);
    } else {
      expect(job.status).toBe(kind==="legacy"?"success":"succeeded");
      expect(uploads).toHaveBeenCalledTimes(kind==="legacy"?2:1);
      expect(jobAudits.filter(x=>x.action===(kind==="legacy"?"contract.document.success":"contract.offline_revision.process_success"))).toHaveLength(1);
      expect(jobAudits.filter(x=>x.action.includes("failure"))).toHaveLength(0);
      const pdf=await phase("public-private-pdf-download",7000,async()=>{
        const base=await server!.app.getUrl();
        const ticket=await fetch(base+("/files/"+(kind==="legacy"?job.pdfFileId:outputCalls.find(call=>call.mime==="application/pdf")?.fileId)+"/download-ticket"),{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({confirmationPassword:server!.password,downloadReason:"实际核对历史LO字体输出"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const downloaded=await fetch(base+value.downloadUrl);expect(downloaded.status).toBe(200);const bytes=Buffer.from(await downloaded.arrayBuffer());expect(sha(bytes)).toBe(outputCalls.find(call=>call.mime==="application/pdf")!.sha256);await writeFile(join(directory,"actual.pdf"),bytes);return bytes;
      });
      await phase("original-physical-glyph-check",25000,async()=>{const text=inspectActualTemplatePdf(kind==="legacy"?prepared.source:prepared.revision,pdf,"B-"+kind+"-actual-pending-"+expectation);expect(text.replace(/\s/gu,"")).toContain(kind==="legacy"?"历史待处理生成独立核验":"用户线下修订独立核验");});
      if(expectation==="observe")await writeFile(join(directory,"INCONCLUSIVE.json"),JSON.stringify({reason:"Actual public success and physical qualification passed; no blank-success reproduced"}));
    }
    const ownerAfter=(await prepared.get("/contract-drafts/"+prepared.draft.version.id+"/workbench")).version;
    expect(ownerAfter).toMatchObject({draftRevision:prepared.ownerBefore.draftRevision,documentContentRevision:prepared.ownerBefore.documentContentRevision,documentContentFingerprint:prepared.ownerBefore.documentContentFingerprint});
    await writeFile(join(directory,"owner-after.json"),JSON.stringify(ownerAfter,null,2));
    if(kind==="offline") {
      const base=await server!.app.getUrl();
      const capability=await fetch(base+"/files/"+prepared.inputFileId+"/download-ticket-capability",{headers:prepared.draft.headers});expect(capability.status).toBe(200);expect(await capability.json()).toMatchObject({action:{enabled:true}});
      const ticket=await fetch(base+"/files/"+prepared.inputFileId+"/download-ticket",{method:"POST",headers:prepared.draft.headers,body:JSON.stringify({confirmationPassword:server!.password,downloadReason:"核对失败后用户原修订文件保留"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const response=await fetch(base+value.downloadUrl);expect(response.status).toBe(200);expect(sha(Buffer.from(await response.arrayBuffer()))).toBe(sha(prepared.revision));
      const sources=await prepared.get("/contract-workbench/"+prepared.draft.version.id+"/documents");expect(sources.find((item:{id:string})=>item.id===prepared.legacy.id)).toEqual(prepared.sourceFact);
      await writeFile(join(directory,"original-input-preserved.json"),JSON.stringify({inputFileId:prepared.inputFileId,inputSha256:sha(prepared.revision),publicAuthorizedDownload:true,originalSourceUnchanged:true,workerOutputCount:outputCalls.length},null,2));
    }
    for (const entry of [manifest.fontconfig, manifest.converter.native, manifest.converter.wrapper, ...manifest.fonts]) expect(sha(await readFile(entry.path))).toBe(entry.sha256);
  } catch(cause) {await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("历史LO实际链失败，证据 "+directory,{cause});}
  finally {if(server)await phase("shutdown-only-not-file-deletion",10000,async()=>{await server!.processor.onApplicationShutdown();await server!.app.close();},performance.now()+10000);}
}
