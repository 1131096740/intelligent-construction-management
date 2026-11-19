import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { current261LifecycleCase } from "../../prisma/task12-current261-lifecycle-cases.cjs";
import { type Task12LocalLifecycleCaseInput, type Task12LocalLifecycleRequest } from "./task12-local-lifecycle-case";
import { runTask12Con18Withdrawal } from "./task12-con18-withdrawal-case";
import { observeTask12Con18Signed, observeTask12Con18Rounds } from "./task12-con18-round-observer";
// Protocol model only; not a Nest, database, storage or real PDF engine result.
const uid = (n: number) => "10000000-0000-4000-8000-" + n.toString().padStart(12, "0");
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// The parser is a modeled external boundary. Page tags deliberately stand in
// for painted glyphs; these checks do not qualify a physical PDF reader.
async function modeledPdf(pages: readonly string[]) {
  const document = await PDFDocument.create();
  for (const text of pages) document.addPage().node.set(PDFName.of("ModelPageText"), PDFHexString.fromText(text));
  return Buffer.from(await document.save());
}
async function modeledPdfText(bytes: Buffer) {
  return (await PDFDocument.load(bytes)).getPages().map(page => {
    const text = page.node.get(PDFName.of("ModelPageText"));
    if (!(text instanceof PDFHexString)) throw new Error("MODEL_PAGE_TEXT_MISSING");
    return text.decodeText();
  });
}
function networkModel(mode = "normal", equipment = false) {
  const source = readFileSync(resolve(__dirname, equipment ? "../../assets/templates/equipment-rental-real-v1.docx" : "../../assets/templates/material-purchase-real-v1.docx"));
  const contractName = equipment ? "本轮隔离V2设备租赁合同" : "本轮隔离V2材料合同";
  const sourceFileId = uid(20), templateId = uid(21), layoutId = uid(22), previewJobId = uid(23), previewPdfFileId = uid(24);
  const contractId = uid(30), versionId = uid(31), sealId = uid(32), archiveId = uid(33), directorId = uid(3);
  const calls: Array<{actor: number; request: Task12LocalLifecycleRequest}> = [];
  const files = new Map<string, Buffer>(); let alive = true, revision = 1, contentRevision = 1, round = 0, generation = 0, archiveCalls = 0;
  let clause = "", fingerprint = "a".repeat(64), mapped: ReturnType<typeof prepareLayoutSourceMapping>["mapping"];
  let activeGeneration: { id: string; docxFileId: string; pdfFileId: string } | undefined;
  let round3: unknown, archived: unknown;
  const finalApprovals = new Set<number>(); let sealed = false;
  const expiry = new Date(1000 + 120000).toISOString();
  const checkpointVersion = () => ({ id: versionId, status: "draft", layoutTemplateVersionId: layoutId, draftRevision: revision,
    documentContentRevision: contentRevision, documentContentFingerprint: fingerprint, latestDraftPreviewDocumentId: activeGeneration?.id });
  const input: Task12LocalLifecycleCaseInput = {
    signal: new AbortController().signal,
    fixture: { ...(equipment ? { case: current261LifecycleCase("inside:equipment_rental") } : {}), approval: { project: {id:uid(10)}, handler: {id:uid(1)}, users: Array.from({length:8},(_,i)=>({id:uid(i+1),phone:"1380000000"+i})) },
      master: { CompanyEntity: [{id:uid(11),name:"我方公司"}], BusinessPartyVersion:[{id:uid(12)}] } },
    passwords: Array.from({length:8},(_,i)=>(i+1).toString().repeat(64)), sourceDocx: source,
    originals: [Buffer.from("%PDF-1.4 signed one"),Buffer.from("%PDF-1.4 signed two")],
    readPdfDrawnText: modeledPdfText,
    bridge: {
      check() { if(!alive) throw new Error("MODEL_BRIDGE_CLOSED"); }, now:()=>1000, wait:async()=>undefined,
      async download(_actor,path) {
        if(path.includes("2000-01-01")) return {status:403,bytes:Buffer.alloc(0),mimeType:""};
        const file=files.get(path.split("/")[2]); if(!file) throw new Error("model missing file");
        return {status:200,mimeType:path.includes("/files/"+uid(51))||path.includes("/files/"+uid(52))||path.includes("/files/"+uid(53))?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":"application/pdf",bytes:mode==="wrong-download"&&path.includes(uid(80))?Buffer.from("bad"):file};
      },
      async send(actor,request) {
        calls.push({actor,request});const {method,path,json}=request;
        const ok=(body:unknown={},status=method==="POST"?201:200)=>({status,body});
        if(path==="/contracts/workbench?view=pending_action&page=1&pageSize=100") {
          const pending = round===2 && actor>=1 && actor<=5 && !(mode==="missing-pending" && actor===3) || mode==="premature-seal-task" || (actor===6&&finalApprovals.size===5&&!sealed) || (actor===0&&sealed&&!archived);
          const rows = pending ? [{contractVersionId:versionId}] : [];
          return ok({rows,meta:{total:rows.length},summary:{pending_action:rows.length}},200);
        }
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
        if(path===base+"/publication")return ok({...version,status:"published",draftRevision:2,previewPdfFileId,publishedByUserId:directorId,placeholderSchema:{bills:[{key:equipment?"equipmentRentals":"materials"}],sourceMapping:{...mapped,confirmation:{sourceFileId,sourceSha256:digest(source),draftRevision:2,mappingFingerprint:mapped.fingerprint,previewJobId,previewPdfFileId,actorUserId:directorId}}}});
        if(path==="/contracts")return ok({contract:{id:contractId,contractTypeKey:equipment&&mode!=="wrong-business-response"?"equipment_rental":"material_purchase"},version:{id:versionId}});
        const draft="/contract-drafts/"+versionId, contract="/contracts/"+versionId;
        if(path===draft+"/edit-lease")return ok({token:"z".repeat(43),leaseRevision:1,expiresAt:expiry});
        if(path===draft+"/document-body")return ok({sourceSha256:digest(source),blocks:[{id:"position-1",editable:true,text:equipment?"3.甲方需要延长本合同租赁期限的，应在合同期限届满前30日内，与乙方续签合同。":"4.若卖方违背原约定"}]});
        if(path===draft&&method==="PUT") {
          const document=(json?.draft as {draftData:{documentBody?:{edits:Array<{text:string}>}}}).draftData.documentBody;
          if(document) {const next=document.edits[0].text;if(next!==clause){contentRevision++;fingerprint=contentRevision.toString().repeat(64);clause=next;}}
          revision++;return ok();
        }
        if(path===draft+"/workbench")return ok({version:checkpointVersion(),draft:{},bills:[],lease:{state:"held_by_me",expiresAt:expiry},documents:activeGeneration?[{...activeGeneration,purpose:"draft",status:mode==="failed-first"?"failed":"success",sourceRevision:revision,documentContentRevision:contentRevision,documentContentFingerprint:fingerprint}]:[]});
        if(path===draft+"/preview-generation") {
          generation++;
          if(generation===3 && mode.startsWith("reuse")) {
            if(mode==="reuse-changed-pdf")files.set(activeGeneration!.pdfFileId,Buffer.from("%PDF-other"));
            if(mode==="reuse-changed") {const zip=new PizZip(files.get(activeGeneration!.docxFileId)!);zip.comment="changed replay artifact";files.set(activeGeneration!.docxFileId,zip.generate({type:"nodebuffer"}));}
            return ok({generationId:activeGeneration!.id,status:"queued",sourceRevision:revision,documentContentRevision:contentRevision,documentContentFingerprint:fingerprint});
          }
          activeGeneration={id:uid(40+generation),docxFileId:uid(50+generation),pdfFileId:uid(60+generation)};
          const zip=new PizZip(source), xml=zip.file("word/document.xml")!.asText();zip.file("word/document.xml",xml.replace("</w:body>","<w:p><w:r><w:t>"+clause+"</w:t></w:r></w:p></w:body>"));
          files.set(activeGeneration.docxFileId,mode==="old-second-word"&&generation===2?source:zip.generate({type:"nodebuffer"}));
          const pdfClause = mode === "stale-second-pdf" && generation === 2 || mode === "stale-final-pdf" && generation === 3 ? "双方补充约定第一版。" : clause;
          const pages = generation === 1 ? [contractName, pdfClause] : generation === 2 ? [contractName + " " + pdfClause] : [contractName, "最终生成中间页", pdfClause];
          files.set(activeGeneration.pdfFileId,await modeledPdf(pages));
          return ok({generationId:activeGeneration.id,status:"queued",sourceRevision:revision,documentContentRevision:contentRevision,documentContentFingerprint:fingerprint});
        }
        if(path.startsWith("/files/")&&path.endsWith("/download-ticket"))return actor===7?ok({},403):ok({fileId:path.split("/")[2],mimeType:Number(path.split("/")[2].slice(-12))<60?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":"application/pdf",sizeBytes:files.get(path.split("/")[2])!.length,downloadUrl:path.replace("/download-ticket","/download?token=model&expiresAt=2099-01-01")});
        if(path===draft+"/submission") {
          if(actor===7)return ok({},403);if(json?.blanksReviewed===false)return ok({},409);
          if(round===3)return ok(round3);round++;const result={approvalInstanceId:uid(70+round)};if(round===3)round3=result;return ok(result);
        }
        if(path.startsWith("/contracts/"+contractId+"?"))return ok({contractVersionId:versionId,approvalTimeline:mode==="inherited-timeline"&&round===2?[{action:"approve"}]:[],reviewApprovalContext:{expectedNodeIndex:actor-1,expectedParallelApprovalEpoch:"e".repeat(64),expectedApprovalInstanceId:uid(70+(mode==="old-context"&&round===2&&actor===3?1:round))},withdrawApprovalContext:{expectedApprovalInstanceId:uid(71)},v2Lifecycle:{status:"ready",state:"pending_seal",approvalInstanceId:uid(72),sealTaskId:sealId,documentContentRevision:contentRevision,documentContentFingerprint:mode==="wrong-seal"?"f".repeat(64):fingerprint}});
        if(path===contract+"/approval") { if(round===2&&json?.decision==="approve")finalApprovals.add(actor); return ok({},round===1&&actor===1&&mode!=="stale-accepted"?409:201); }
        if(path===contract+"/approval-withdrawal")return ok();
        if(path===contract+"/seal-confirmation") { if(actor===6)sealed=true;return ok({status:"seal_approved_pending_archive"},actor===0?403:201); }
        if(path===contract+"/signed-archive") {
          if(actor===7)return ok({},403);archiveCalls++;
          if(archived) { const previous=archived as {fileIds:unknown}; return JSON.stringify(previous.fileIds)===JSON.stringify(json?.fileIds)?ok(archived):ok({},409); }
          archived={status:"effective",contractVersionId:versionId,archiveId,fileIds:json?.fileIds};return ok(archived);
        }
        if(path.startsWith(contract+"/archive-requests/"))return ok({result:archived});
        throw new Error("unexpected modeled route "+method+" "+path);
      }
    }
  };
  return {input,calls,close:()=>{alive=false;},archiveCalls:()=>archiveCalls};
}

function ownerModel(options: { unsigned?: boolean; carried?: boolean } = {}) {
 const nodes=Array.from({length:5},(_,index)=>({protocolVersion:1,executionMode:"parallel",roleKeys:["role-"+index],mode:"any",approvedRoleKeys:options.carried&&index===0?["role-0"]:[]}));
 let calls=0;return { $transaction: async (fn: (tx: object)=>Promise<unknown>)=>{
  calls++;const before=calls===1;
  const old={approvalInstanceId:uid(71),actorUserId:uid(3),signatureFileIdSnapshot:before&&!options.unsigned?uid(14):null,signatureVersionIdSnapshot:before&&!options.unsigned?uid(15):null,signatureSha256Snapshot:before&&!options.unsigned?"a".repeat(64):null};
  return fn({$executeRawUnsafe:async()=>{},approvalInstance:{findUnique:async()=>({businessType:"contract_version",businessId:uid(31),flowType:"contract.approve",status:"in_progress"}),findMany:async()=>[{id:uid(71),status:"withdrawn"},{id:uid(72),status:"in_progress",frozenNodes:nodes,currentNodeIndex:0}]},approvalActionLog:{findMany:async()=>[old]}});
 }};
}
function observerModel(options: { unsigned?: boolean; carried?: boolean } = {}) {
 const owner=ownerModel(options) as never;
 return {signed:(version:string,round:string,actor:string)=>observeTask12Con18Signed(owner,version,round,actor,()=>undefined),rounds:(version:string,old:string,current:string)=>observeTask12Con18Rounds(owner,version,old,current,()=>undefined),archived:async()=>true};
}
it("assembles the public case with the native read-only window over modeled SQL",async()=>{
 const model=networkModel("normal",true), fixture=model.input.fixture;
 const holder={exports:{} as {
  beginTask12Con18OwnerWindow:(cap:unknown,login:unknown,view:unknown,fixture:unknown,exec:unknown)=>Promise<object>;
  observeTask12Con18Signed:(key:object,version:string,round:string,actor:string)=>Promise<boolean>;
  observeTask12Con18Rounds:(key:object,version:string,old:string,current:string)=>ReturnType<typeof observeTask12Con18Rounds>;
  observeTask12Con18Archived:(key:object,version:string,round:string,archive:string)=>Promise<boolean>;
  closeTask12Con18OwnerWindow:(key:object)=>Promise<{matched:boolean}>;
 }}, token=Object.freeze({}), login=Object.freeze({}), view=Object.freeze({});
 let calls=0; const exec=async(sql:string,phase:string)=>{
  calls++; const facts=phase.endsWith("signed")?{signed:true}:phase.endsWith("rounds")?{withdrawnRoundId:uid(71),newRoundId:uid(72),withdrawnStatus:"withdrawn",newStatus:"in_progress",oldApproveCount:1,oldSignatureSnapshotsCleared:true,newApproveCount:0,newAllUnsigned:true,newPendingCount:5}:phase.endsWith("archived")?{valid:true}:null;
  expect(sql).toContain("REPEATABLE READ READ ONLY");
  return {stdout:JSON.stringify({nonce:sql.match(/'nonce','([a-f0-9]{64})'/u)![1],phase:sql.match(/'phase','([^']+)'/u)![1],pid:100+calls,start:`2026-11-17T01:00:00.${String(calls).padStart(6,"0")}Z`,facts})};
 };
 const prior={identity:{database:"isolated",databaseOid:"12",namespaceOid:"2200",systemIdentifier:"123"},continuitySql:"MODEL_GUARD",continuitySha256:"a".repeat(64),serverPort:54321};
 const claim=(cap:unknown,p:unknown,v:unknown,f:unknown,e:unknown)=>{expect([cap,p,v,f,e]).toEqual([token,login,view,fixture,exec]);return {prior,modules:{check(){},verifyFull(){}}};};
 const source=readFileSync(resolve(__dirname,"../../prisma/task12-con18-native-owner-window.cjs"),"utf8");
 new Function("require","module",source)((name:string)=>name==="./task12-con18-native-capability.cjs"?{claimTask12Con18OwnerCapability:claim}:require(name),holder);
 const api=holder.exports, key=await api.beginTask12Con18OwnerWindow(token,login,view,fixture,exec);
 const observer={signed:(version:string,round:string,actor:string)=>api.observeTask12Con18Signed(key,version,round,actor),rounds:(version:string,old:string,current:string)=>api.observeTask12Con18Rounds(key,version,old,current),archived:(version:string,round:string,archive:string)=>api.observeTask12Con18Archived(key,version,round,archive)};
 const result=await runTask12Con18Withdrawal({...model.input,observer});
 expect(result.newRoundPending).toBe(5);expect((await api.closeTask12Con18OwnerWindow(key)).matched).toBe(true);expect(calls).toBe(5);
});
it("continues the fresh round through five approvals, seal and archive",async()=>{
 const model=networkModel();const result=await runTask12Con18Withdrawal({...model.input,observer:observerModel()});
 expect(result).toMatchObject({oldCoordinateRejected:true,changedGeneration:true,newRoundPending:5,oldApprovalsVisible:false,archived:true});
 expect(model.calls.filter(x=>x.request.path.endsWith("/approval")&&x.request.json?.decision==="approve")).toHaveLength(7);
 expect(model.calls.some(x=>x.request.path.endsWith("/seal-confirmation"))).toBe(true);
 expect(model.calls.some(x=>x.request.path.endsWith("/signed-archive"))).toBe(true);
});
it("rejects prior-signature carryover in the independently read round proof",async()=>{
 const model=networkModel();await expect(runTask12Con18Withdrawal({...model.input,observer:observerModel({carried:true})})).rejects.toThrow("ROUND_PROOF");
});
it("rejects archive completion when independent audit proof is incomplete",async()=>{
 const model=networkModel();await expect(runTask12Con18Withdrawal({...model.input,observer:{...observerModel(),archived:async()=>false}})).rejects.toThrow("ARCHIVE_PROOF");
});
it("does not withdraw if the first approval was not durably signed",async()=>{
 const model=networkModel();await expect(runTask12Con18Withdrawal({...model.input,observer:observerModel({unsigned:true})})).rejects.toThrow("FIRST_SIGNATURE");
 expect(model.calls.some(x=>x.request.path.endsWith("/approval-withdrawal"))).toBe(false);
});
it("requires the independent round observer",async()=>{
 const model=networkModel();await expect(runTask12Con18Withdrawal({...model.input} as never)).rejects.toThrow("INPUT");
 expect(model.calls).toHaveLength(0);
});
it("rejects a stale second-generation PDF even if the new Word changed",async()=>{
 const model=networkModel("stale-second-pdf");await expect(runTask12Con18Withdrawal({...model.input,observer:observerModel()})).rejects.toThrow("_PDF");
});

it.each([["stale-accepted","STALE_ROUND"],["missing-pending","TASK_RELAY"],["old-context","NEW_REVIEW_COORDINATES"],["inherited-timeline","NEW_TIMELINE"]])("rejects %s before completing the short case",async(mode,code)=>{
 const model=networkModel(mode);await expect(runTask12Con18Withdrawal({...model.input,observer:observerModel()})).rejects.toThrow(code);
});

it("rejects a new PDF that also carries the withdrawn body",async()=>{
 const model=networkModel(),read=model.input.readPdfDrawnText;
 model.input.readPdfDrawnText=async(bytes,signal)=>{const pages=[...await read(bytes,signal)];pages[pages.length-1]+="4.若卖方违背原约定双方补充约定第一版。";return pages;};
 await expect(runTask12Con18Withdrawal({...model.input,observer:observerModel()})).rejects.toThrow("_PDF");
});

it("retains the first accepted queue coordinates when a document later fails, without submitting",async()=>{
 const model=networkModel("failed-first"), captured:unknown[]=[];const observer={...observerModel(),queued:(value:unknown)=>captured.push(value)};
 await expect(runTask12Con18Withdrawal({...model.input,observer})).rejects.toThrow("TASK12_GENERATED_DOCUMENT_DOCUMENT");
 expect(captured).toHaveLength(1);expect(captured[0]).toMatchObject({versionId:uid(31),generationId:uid(41)});expect(model.calls.every(call=>!call.request.path.endsWith("/submission")||call.request.path.includes("layout"))).toBe(true);
});
