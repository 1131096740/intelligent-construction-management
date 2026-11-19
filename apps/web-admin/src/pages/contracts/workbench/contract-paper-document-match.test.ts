import { describe, expect, it } from "vitest";
import { matchingDocuments } from "./ContractBodyPaperPreview.vue";

const context={contractVersionId:"version",draftRevision:8,layoutTemplateVersionId:"layout",documentContentRevision:7,sourceSha256:"a".repeat(64),mechanicalContactLayoutVersion:"mechanical-contact-layout-v2" as const};
const fingerprint="b".repeat(64);
const matchingPaperDocuments=(documents:unknown[],identity:typeof context | (Omit<typeof context,"mechanicalContactLayoutVersion"> & {mechanicalContactLayoutVersion:null}),contentFingerprint:string)=>matchingDocuments({context:identity},{documents,fingerprint:contentFingerprint});
const document=(id:string,version?:string)=>({id,purpose:"draft",status:"success",layoutTemplateVersionId:"layout",documentContentRevision:7,documentContentFingerprint:fingerprint,inputSnapshot:{bodyDocument:{sourceSha256:context.sourceSha256},...(version?{mechanicalContactLayoutVersion:version}:{})}});

describe("paper preview layout version",()=>{
 it("excludes an old successful PDF for the same content and accepts the new layout version",()=>{
   const old=document("old"),v1=document("v1","mechanical-contact-layout-v1"),current=document("current","mechanical-contact-layout-v2");
   expect(matchingPaperDocuments([old,v1,current],context,fingerprint).map(d=>d.id)).toEqual(["current"]);
   expect(matchingPaperDocuments([old],context,fingerprint)).toEqual([]);
 });
 it("continues to accept an unversioned non-mechanical PDF",()=>{
   expect(matchingPaperDocuments([document("old"),document("current","mechanical-contact-layout-v2")],{...context,mechanicalContactLayoutVersion:null},fingerprint).map(d=>d.id)).toEqual(["old"]);
 });
 it("does not match a document whose other content identity differs",()=>{
   expect(matchingPaperDocuments([{...document("current","mechanical-contact-layout-v2"),documentContentFingerprint:"c".repeat(64)}],context,fingerprint)).toEqual([]);
 });
});
