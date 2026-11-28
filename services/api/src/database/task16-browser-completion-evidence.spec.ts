import { mkdtempSync, readFileSync, rmSync, writeFileSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import { writeCompletionEvidence } from "./task16-browser-completion-evidence";

describe("completion evidence preserves an earlier payment",()=>{
 let directory:string;
 beforeEach(()=>{directory=mkdtempSync("/private/tmp/jg398-browser-evidence-");});
 afterEach(()=>rmSync(directory,{recursive:true,force:true}));
 it.each(["write","fsync","directory-fsync","interrupt"])("keeps the first immutable receipt after second-stage %s failure",failure=>{
  const first={stage:1,keySha256:"first"};writeCompletionEvidence(directory,"receipt.json",first);
  const original=readFileSync(join(directory,"receipt.json"));
  let syncCalls=0;
  expect(()=>writeCompletionEvidence(directory,"receipt-stage2.json",{stage:2,keySha256:"second"},{
   write:(fd,data)=>{if(failure==="write")throw Error("write");if(failure==="interrupt"){writeFileSync(fd,data.slice(0,4));throw Error("interrupted");}writeFileSync(fd,data);},
   sync:fd=>{syncCalls++;if(failure==="fsync"||(failure==="directory-fsync"&&syncCalls===2))throw Error("fsync");fsyncSync(fd);}
  })).toThrow();
  expect(readFileSync(join(directory,"receipt.json"))).toEqual(original);
  expect(()=>writeCompletionEvidence(directory,"receipt.json",{stage:1,keySha256:"replacement"})).toThrow();
  expect(readFileSync(join(directory,"receipt.json"))).toEqual(original);
 });
});
