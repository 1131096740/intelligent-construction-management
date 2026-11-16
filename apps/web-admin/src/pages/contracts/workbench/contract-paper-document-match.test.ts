import { describe, expect, it } from "vitest";
import { matchingPaperDocuments } from "./contract-paper-document-match";

const context={layoutTemplateVersionId:"layout",documentContentRevision:7,sourceSha256:"a".repeat(64),mechanicalContactLayoutVersion:"mechanical-contact-layout-v1" as const};
const fingerprint="b".repeat(64);
const document=(id:string,version?:string)=>({id,purpose:"draft",status:"success",layoutTemplateVersionId:"layout",documentContentRevision:7,documentContentFingerprint:fingerprint,inputSnapshot:{bodyDocument:{sourceSha256:context.sourceSha256},...(version?{mechanicalContactLayoutVersion:version}:{})}});

describe("paper preview layout version",()=>{
 it("excludes an old successful PDF for the same content and accepts the new layout version",()=>{
   const old=document("old"),current=document("current","mechanical-contact-layout-v1");
   expect(matchingPaperDocuments([old,current],context,fingerprint).map(d=>d.id)).toEqual(["current"]);
   expect(matchingPaperDocuments([old],context,fingerprint)).toEqual([]);
 });
 it("continues to accept an unversioned non-mechanical PDF",()=>{
   expect(matchingPaperDocuments([document("old"),document("current","mechanical-contact-layout-v1")],{...context,mechanicalContactLayoutVersion:null},fingerprint).map(d=>d.id)).toEqual(["old"]);
 });
 it("does not match a document whose other content identity differs",()=>{
   expect(matchingPaperDocuments([{...document("current","mechanical-contact-layout-v1"),documentContentFingerprint:"c".repeat(64)}],context,fingerprint)).toEqual([]);
 });
});
