import { runTask12LocalLifecycleCase, claimTask12LocalLifecycleCheckpoint, expectTask12LocalLifecycleAuditRollback, finishTask12LocalLifecycleCase } from "./task12-local-lifecycle-case";
describe("fixed local lifecycle public exercise (network model only)", () => {
  it("rejects an already aborted case before sending a business request", async () => {
    const controller = new AbortController(); controller.abort(); const send = jest.fn();
    await expect(runTask12LocalLifecycleCase({ signal: controller.signal, bridge: { send } } as never)).rejects.toThrow("TASK12_LOCAL_LIFECYCLE_CASE_INPUT");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects forged checkpoints in every public continuation boundary", async () => {
    expect(() => claimTask12LocalLifecycleCheckpoint({})).toThrow("TASK12_LOCAL_LIFECYCLE_CASE_CHECKPOINT");
    await expect(expectTask12LocalLifecycleAuditRollback({})).rejects.toThrow("TASK12_LOCAL_LIFECYCLE_CASE_CHECKPOINT");
    await expect(finishTask12LocalLifecycleCase({})).rejects.toThrow("TASK12_LOCAL_LIFECYCLE_CASE_CHECKPOINT");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { type Task12LocalLifecycleCaseInput, type Task12LocalLifecycleRequest } from "./task12-local-lifecycle-case";
// This state machine models HTTP responses only: no listening socket, database,
// document engine, storage provider or admission proof is created by this test.
const uid = (n: number) => "10000000-0000-4000-8000-" + n.toString().padStart(12, "0");
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const source = readFileSync(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
function networkModel(mode = "normal") {
  const sourceFileId = uid(20), templateId = uid(21), layoutId = uid(22), previewJobId = uid(23), previewPdfFileId = uid(24);
  const contractId = uid(30), versionId = uid(31), sealId = uid(32), archiveId = uid(33), directorId = uid(3);
  const calls: Array<{actor: number; request: Task12LocalLifecycleRequest}> = [];
  const files = new Map<string, Buffer>(); let alive = true, revision = 1, contentRevision = 1, round = 0, generation = 0, archiveCalls = 0;
  let clause = "", fingerprint = "a".repeat(64), mapped: ReturnType<typeof prepareLayoutSourceMapping>["mapping"];
  let activeGeneration: { id: string; docxFileId: string; pdfFileId: string } | undefined;
  let round3: unknown, archived: unknown;
  const expiry = new Date(1000 + 120000).toISOString();
  const checkpointVersion = () => ({ id: versionId, status: "draft", layoutTemplateVersionId: layoutId, draftRevision: revision,
    documentContentRevision: contentRevision, documentContentFingerprint: fingerprint, latestDraftPreviewDocumentId: activeGeneration?.id });
  const input: Task12LocalLifecycleCaseInput = {
    signal: new AbortController().signal,
    fixture: { approval: { project: {id:uid(10)}, handler: {id:uid(1)}, users: Array.from({length:8},(_,i)=>({id:uid(i+1),phone:"1380000000"+i})) },
      master: { CompanyEntity: [{id:uid(11),name:"我方公司"}], BusinessPartyVersion:[{id:uid(12)}] } },
    passwords: Array.from({length:8},(_,i)=>(i+1).toString().repeat(64)), sourceDocx: source,
    originals: [Buffer.from("%PDF-1.4 signed one"),Buffer.from("%PDF-1.4 signed two")],
    readPdfDrawnText: async () => ["本轮隔离V2材料合同"],
    bridge: {
      check() { if(!alive) throw new Error("MODEL_BRIDGE_CLOSED"); }, now:()=>1000, wait:async()=>undefined,
      async download(_actor,path) {
        if(path.includes("2000-01-01")) return {status:403,bytes:Buffer.alloc(0)};
        const file=files.get(path.split("/")[2]); if(!file) throw new Error("model missing file");
        return {status:200,bytes:mode==="wrong-download"&&path.includes(uid(80))?Buffer.from("bad"):file};
      },
      async send(actor,request) {
        calls.push({actor,request});const {method,path,json}=request;
        const ok=(body:unknown={},status=method==="POST"?201:200)=>({status,body});
        if(path==="/auth/login")return ok({tokens:{accessToken:"model-jwt-"+actor}});
        if(path==="/me/signature/canvas")return ok();
        if(path==="/files") {
          const blob=request.form?.get("file"); if(!(blob instanceof Blob))throw new Error("model multipart");
          const bytes=Buffer.from(await blob.arrayBuffer());const fileId=blob.type==="application/pdf"?uid(80+files.size):sourceFileId;
          files.set(fileId,bytes);return ok({id:fileId,contentSha256:digest(bytes),sizeBytes:bytes.length,uploadedByUserId:directorId});
        }
        const base="/contract-layout-template-versions/"+layoutId, version={id:layoutId,layoutTemplateId:templateId,docxFileId:sourceFileId};
        if(path==="/contract-layout-templates")return ok({template:{id:templateId},version:{...version,status:"draft",draftRevision:1}});
        if(path===base+"/source-positions")return ok({...readLayoutSourcePositions(source),versionId:layoutId,sourceFileId,draftRevision:1,confirmed:false,mappingFingerprint:null,bindings:[]});
        if(path===base+"/source-mapping") {mapped=prepareLayoutSourceMapping(source,sourceFileId,2,json?.bindings as never).mapping;return ok({draftRevision:2,mappingFingerprint:mapped.fingerprint,confirmed:false});}
        if(path===base+"/inspection")return ok({sourceRevision:2,blockingErrors:[],hasBillLoop:true});
        const preview={id:previewJobId,layoutTemplateVersionId:layoutId,sourceRevision:2,createdByUserId:directorId};
        if(path===base+"/preview-generation")return method==="POST"?ok({...preview,status:"queued",previewPdfFileId:null}):ok({...preview,status:"succeeded",previewPdfFileId,errorMessage:null,startedAt:"2026-11-13T00:00:00Z",completedAt:"2026-11-13T00:00:01Z"});
        if(path===base+"/source-mapping-confirmation")return ok({confirmed:true,draftRevision:2,previewPdfFileId});
        if(path===base+"/submission")return ok({...version,status:"submitted",draftRevision:2,submittedByUserId:directorId});
        if(path===base+"/publication")return ok({...version,status:"published",draftRevision:2,previewPdfFileId,publishedByUserId:directorId,placeholderSchema:{bills:[{key:"materials"}],sourceMapping:{...mapped,confirmation:{sourceFileId,sourceSha256:digest(source),draftRevision:2,mappingFingerprint:mapped.fingerprint,previewJobId,previewPdfFileId,actorUserId:directorId}}}});
        if(path==="/contracts")return ok({contract:{id:contractId},version:{id:versionId}});
        const draft="/contract-drafts/"+versionId, contract="/contracts/"+versionId;
        if(path===draft+"/edit-lease")return ok({token:"z".repeat(43),leaseRevision:1,expiresAt:expiry});
        if(path===draft+"/document-body")return ok({sourceSha256:digest(source),blocks:[{id:"position-1",editable:true,text:"4.若卖方违背原约定"}]});
        if(path===draft&&method==="PUT") {
          const document=(json?.draft as {draftData:{documentBody?:{edits:Array<{text:string}>}}}).draftData.documentBody;
          if(document) {const next=document.edits[0].text;if(next!==clause){contentRevision++;fingerprint=contentRevision.toString().repeat(64);clause=next;}}
          revision++;return ok();
        }
        if(path===draft+"/workbench")return ok({version:checkpointVersion(),draft:{},bills:[],lease:{state:"held_by_me",expiresAt:expiry},documents:activeGeneration?[{...activeGeneration,purpose:"draft",status:"success",sourceRevision:revision,documentContentRevision:contentRevision,documentContentFingerprint:fingerprint}]:[]});
        if(path===draft+"/preview-generation") {
          generation++;activeGeneration={id:uid(40+generation),docxFileId:uid(50+generation),pdfFileId:uid(60+generation)};
          const zip=new PizZip(source), xml=zip.file("word/document.xml")!.asText();zip.file("word/document.xml",xml.replace("</w:body>","<w:p><w:r><w:t>"+clause+"</w:t></w:r></w:p></w:body>"));
          files.set(activeGeneration.docxFileId,zip.generate({type:"nodebuffer"}));files.set(activeGeneration.pdfFileId,Buffer.from("%PDF-model"));
          return ok({generationId:activeGeneration.id,status:"queued",sourceRevision:revision,documentContentRevision:contentRevision,documentContentFingerprint:fingerprint});
        }
        if(path.startsWith("/files/")&&path.endsWith("/download-ticket"))return actor===7?ok({},403):ok({downloadUrl:path.replace("/download-ticket","/download?token=model&expiresAt=2099-01-01")});
        if(path===draft+"/submission") {
          if(actor===7)return ok({},403);if(json?.blanksReviewed===false)return ok({},409);
          if(round===3)return ok(round3);round++;const result={approvalInstanceId:uid(70+round)};if(round===3)round3=result;return ok(result);
        }
        if(path.startsWith("/contracts/"+contractId+"?"))return ok({contractVersionId:versionId,reviewApprovalContext:{expectedParallelApprovalEpoch:"e".repeat(64),expectedApprovalInstanceId:uid(70+round)},withdrawApprovalContext:{expectedApprovalInstanceId:uid(71)},v2Lifecycle:{status:"ready",state:"pending_seal",approvalInstanceId:uid(73),sealTaskId:sealId,documentContentRevision:contentRevision,documentContentFingerprint:mode==="wrong-seal"?"f".repeat(64):fingerprint}});
        if(path===contract+"/approval")return ok({},round===1&&actor===1?409:201);
        if(path===contract+"/approval-withdrawal")return ok();
        if(path===contract+"/seal-confirmation")return ok({status:"seal_approved_pending_archive"},actor===0?403:201);
        if(path===contract+"/signed-archive") {
          if(actor===7)return ok({},403);archiveCalls++;
          if(archiveCalls===1)return ok({},mode==="audit-unexpected-success"?201:500);
          archived={status:"effective",contractVersionId:versionId,archiveId,fileIds:json?.fileIds};return ok(archived);
        }
        if(path.startsWith(contract+"/archive-requests/"))return ok({result:archived});
        throw new Error("unexpected modeled route "+method+" "+path);
      }
    }
  };
  return {input,calls,close:()=>{alive=false;},archiveCalls:()=>archiveCalls};
}

it("uses real public request shapes for three rounds, original-key recovery and private downloads (model only)", async()=>{
  const model=networkModel();const originals=await runTask12LocalLifecycleCase(model.input);
  const before=claimTask12LocalLifecycleCheckpoint(originals);expect(before.stage).toBe("ORIGINALS");expect(before.roundIds).toEqual({withdrawn:uid(71),rejected:uid(72),approved:uid(73)});
  expect(()=>claimTask12LocalLifecycleCheckpoint({...originals})).toThrow("CHECKPOINT");
  await expect(finishTask12LocalLifecycleCase(originals)).rejects.toThrow("CHECKPOINT");
  const rollback=await expectTask12LocalLifecycleAuditRollback(originals);
  expect(()=>claimTask12LocalLifecycleCheckpoint(originals)).toThrow("CHECKPOINT");expect(claimTask12LocalLifecycleCheckpoint(rollback).stage).toBe("AUDIT_ROLLBACK");
  const summary=await finishTask12LocalLifecycleCase(rollback);expect(summary).toMatchObject({storage:"LOCAL_ONLY",cosAccepted:false,browserAccepted:false,full394Accepted:false});
  expect(claimTask12LocalLifecycleCheckpoint(summary).stage).toBe("COMPLETE");
  const archiveRequests=model.calls.filter(call=>call.actor===0&&call.request.path.endsWith("/signed-archive"));
  expect(archiveRequests).toHaveLength(3);expect(new Set(archiveRequests.map(call=>call.request.json?.idempotencyKey)).size).toBe(1);expect(archiveRequests[0].request.json).toEqual(archiveRequests[2].request.json);
  expect(model.calls.filter(call=>call.request.path==="/auth/login")).toHaveLength(8);
  expect(model.calls.filter(call=>call.request.path.endsWith("/approval")&&call.request.json?.decision==="approve")).toHaveLength(7);
  expect(JSON.stringify(summary)).not.toMatch(/model-jwt|password|downloadUrl/);
  await expect(finishTask12LocalLifecycleCase(rollback)).rejects.toThrow("CHECKPOINT");model.close();expect(()=>claimTask12LocalLifecycleCheckpoint(summary)).toThrow("MODEL_BRIDGE_CLOSED");
});
it("stops before seal when the public current document fingerprint differs",async()=>{
  const m=networkModel("wrong-seal");await expect(runTask12LocalLifecycleCase(m.input)).rejects.toThrow("_SEAL");expect(m.calls.some(call=>call.request.path.endsWith("/seal-confirmation"))).toBe(false);
});
it("consumes a failed audit attempt without allowing retry after unexpected success",async()=>{
  const m=networkModel("audit-unexpected-success"), token=await runTask12LocalLifecycleCase(m.input);
  await expect(expectTask12LocalLifecycleAuditRollback(token)).rejects.toThrow("AUDIT_FAILURE");
  await expect(expectTask12LocalLifecycleAuditRollback(token)).rejects.toThrow("CHECKPOINT");expect(m.archiveCalls()).toBe(1);
});
it("invalidates the private continuation when its original bridge has closed",async()=>{
  const m=networkModel(), token=await runTask12LocalLifecycleCase(m.input);m.close();
  expect(()=>claimTask12LocalLifecycleCheckpoint(token)).toThrow("MODEL_BRIDGE_CLOSED");
  await expect(expectTask12LocalLifecycleAuditRollback(token)).rejects.toThrow("MODEL_BRIDGE_CLOSED");expect(m.archiveCalls()).toBe(0);
});
it("rejects altered signed-original bytes and stops without any later download",async()=>{
  const m=networkModel(), token=await runTask12LocalLifecycleCase(m.input),rollback=await expectTask12LocalLifecycleAuditRollback(token);
  const originalDownload=m.input.bridge.download;m.input.bridge.download=async(actor,path)=>path.includes("expiresAt=2099")?{status:200,bytes:Buffer.from("changed original")}:originalDownload(actor,path);
  await expect(finishTask12LocalLifecycleCase(rollback)).rejects.toThrow("_DOWNLOAD");
  await expect(finishTask12LocalLifecycleCase(rollback)).rejects.toThrow("CHECKPOINT");
});
it("uses the one-shot physical PDF reader once while downloading all three generated pairs",async()=>{
  const m=networkModel();let reads=0,downloads=0;
  const download=m.input.bridge.download;
  m.input.bridge.download=async(actor,path)=>{downloads++;return download(actor,path);};
  m.input.readPdfDrawnText=async()=>{if(++reads>1)throw new Error("ONE_READER_ALREADY_CONSUMED");return ["本轮隔离V2材料合同"];};
  const token=await runTask12LocalLifecycleCase(m.input);
  expect(claimTask12LocalLifecycleCheckpoint(token).stage).toBe("ORIGINALS");expect(reads).toBe(1);expect(downloads).toBe(6);
  expect(m.calls.filter(call=>call.request.path.endsWith("/preview-generation")&&call.request.method==="POST")).toHaveLength(4);
});
it("stops the entire case when the first physical PDF reader fails",async()=>{
  const m=networkModel();let reads=0;
  m.input.readPdfDrawnText=async()=>{reads++;throw new Error("MODEL_FIRST_READER_FAILED");};
  await expect(runTask12LocalLifecycleCase(m.input)).rejects.toThrow("MODEL_FIRST_READER_FAILED");expect(reads).toBe(1);
  expect(m.calls.filter(call=>call.request.path.startsWith("/contract-drafts/")&&call.request.path.endsWith("/submission"))).toHaveLength(0);
  expect(m.calls.filter(call=>call.request.path.startsWith("/contract-drafts/")&&call.request.path.endsWith("/preview-generation"))).toHaveLength(1);
});
it("still rejects an unmodified Word in the second round after the sole PDF read",async()=>{
  const m=networkModel();let reads=0,downloads=0;const download=m.input.bridge.download;
  m.input.readPdfDrawnText=async()=>{reads++;return ["本轮隔离V2材料合同"];};
  m.input.bridge.download=async(actor,path)=>{downloads++;return path.includes(uid(52))?{status:200,bytes:source}:download(actor,path);};
  await expect(runTask12LocalLifecycleCase(m.input)).rejects.toThrow("_WORD");expect(reads).toBe(1);expect(downloads).toBe(4);
  expect(m.calls.filter(call=>call.request.path.startsWith("/contract-drafts/")&&call.request.path.endsWith("/preview-generation"))).toHaveLength(2);
});
