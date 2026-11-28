import { mkdtempSync, readFileSync, realpathSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCashFixtureDocument } from "./registered-payment-public-cash-document";

describe("owned public cash source file", () => {
 const runId="da49e313e3da";
 let root:string;
 beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"jg-cash-document-")));});
 afterEach(()=>{for(const entry of readdirSync(root)) unlinkSync(join(root,entry));rmdirSync(root);});
 it("creates one real synthetic PDF, records its digest, and rejects replacement",async()=>{
  const doc=await createCashFixtureDocument(root,runId);
  const bytes=readFileSync(join(root,doc.objectKey));
  expect(bytes.subarray(0,5).toString()).toBe("%PDF-");
  expect(doc.sizeBytes).toBe(bytes.length);
  expect(doc.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(()=>doc.verify()).not.toThrow();
  writeFileSync(join(root,doc.objectKey),Buffer.from("replacement"));
  expect(()=>doc.verify()).toThrow("PUBLIC_CASH_DOCUMENT_CHANGED");
 });
 it("does not overwrite an existing document or follow a symlink",async()=>{
  const file=join(root,`cash-settlement-${runId}.pdf`);
  writeFileSync(file,"existing");
  await expect(createCashFixtureDocument(root,runId)).rejects.toThrow();
  expect(readFileSync(file,"utf8")).toBe("existing");
  const link=join(root,"link");symlinkSync(root,link);
  await expect(createCashFixtureDocument(link,runId)).rejects.toThrow();
 });
});
