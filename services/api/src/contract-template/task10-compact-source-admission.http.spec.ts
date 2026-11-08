import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PizZip from "pizzip";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

const sourceSha = "4da16afa0fb02d88ef670174cc4560772d56266e27a3d61ccba28f0fd158fa48";
const hash = (bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");

describe("A07 exact material compact admission",()=>{
  it("keeps the original compact source intact and refuses missing mandatory party anchors through public mapping",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"jg-task10-A07-compact-admission-"));
    const server=await createTemplateTestServer();
    try{
      const source=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/material-purchase-v1.docx"));expect(hash(source)).toBe(sourceSha);
      const zip=new PizZip(source), xmls=Object.values(zip.files).filter(entry=>!entry.dir&&/^word\/.*\.xml$/u.test(entry.name)).map(entry=>entry.asText());
      expect(xmls.join("")).not.toMatch(/甲方|乙方|party\.owner|party\.counterparty/u);
      const token=await loginTemplateActor(server,"director"),base=await server.app.getUrl();
      const headers={authorization:"Bearer "+token,"content-type":"application/json"};
      const request=(path:string,method="GET",body?:unknown)=>fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
      const form=new FormData();form.append("file",new Blob([new Uint8Array(source)]),"原材料简版技术源.docx");
      const upload=await fetch(base+"/files",{method:"POST",headers:{authorization:headers.authorization},body:form});expect(upload.status).toBe(201);const file=await upload.json();
      const created=await request("/contract-layout-templates","POST",{name:"A07原材料简版缺party核验",contractTypeKey:"material_purchase",docxFileId:file.id,placeholderSchema:{bills:[{key:"materials"}]}});expect(created.status).toBe(201);const layout=await created.json();const path="/contract-layout-template-versions/"+layout.version.id;
      const positionsResponse=await request(path+"/source-positions");expect(positionsResponse.status).toBe(200);const positions=await positionsResponse.json() as {sourceSha256:string;positions:Array<{positionId:string;text:string}>};expect(positions.sourceSha256).toBe(sourceSha);
      const fields=[["{合同名称}","contract.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]];
      const bindings=positions.positions.flatMap(position=>fields.flatMap(([literal,fieldKey])=>{const start=position.text.indexOf(literal);return start<0?[]:[{positionId:position.positionId,start,end:start+literal.length,fieldKey}];}));
      expect(bindings).toHaveLength(4);expect(new Set(bindings.map(x=>x.fieldKey))).toEqual(new Set(["contract.name","contract.temporaryCode","document.watermark"]));
      const attempted=await request(path+"/source-mapping","PATCH",{expectedRevision:1,sourceFileId:file.id,sourceSha256:sourceSha,bindings});const refusal=await attempted.json();
      await writeFile(join(directory,"public-mapping-attempt.json"),JSON.stringify({sourceSha,typeKey:"material_purchase",billAlias:"materials",layout,positions,bindings,status:attempted.status,refusal,scope:"Original source has no party fields; this is admission refusal evidence, not native generation or product font RED"},null,2));
      expect(attempted.status).toBe(400);expect(refusal.message).toBe("请明确选择甲方名称、乙方名称的自动填写位置");
      const after=await request("/contract-layout-templates/"+layout.template.id);expect(after.status).toBe(200);const detail=await after.json();const version=detail.versions.find((x:{id:string})=>x.id===layout.version.id);expect(version).toMatchObject({draftRevision:1,status:"draft",docxFileId:file.id});
      const repeated=await request(path+"/source-positions");expect(repeated.status).toBe(200);expect(await repeated.json()).toEqual(positions);
      const ticket=await request("/files/"+file.id+"/download-ticket","POST",{confirmationPassword:server.password,downloadReason:"核对拒绝后原简版文件未变"});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const downloaded=await fetch(base+value.downloadUrl);expect(downloaded.status).toBe(200);expect(hash(Buffer.from(await downloaded.arrayBuffer()))).toBe(sourceSha);
      await writeFile(join(directory,"verified-refusal.json"),JSON.stringify({verdict:"EXPECTED_MISSING_PARTY_MAPPING_REFUSAL",sourceSha,version,sourceUnchangedByPublicDownload:true,nativeExecuted:false,notGenerationCoverage:true},null,2));console.info("A07材料简版准入证据："+directory);
    }catch(cause){await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("A07材料简版准入失败，证据 "+directory,{cause});}
    finally{await server.processor.onApplicationShutdown();await server.app.close();}
  });
});
