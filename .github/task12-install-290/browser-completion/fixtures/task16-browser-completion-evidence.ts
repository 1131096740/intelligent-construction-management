import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import * as path from "node:path";

type EvidenceIO={write:(fd:number,data:string)=>void;sync:(fd:number)=>void};
const defaultIO:EvidenceIO={write:(fd,data)=>writeFileSync(fd,data),sync:fd=>fsyncSync(fd)};
/** Every phase has a distinct, create-only receipt; later failures cannot truncate an earlier phase. */
export function writeCompletionEvidence(directory:string,name:string,value:object,io:EvidenceIO=defaultIO):void {
 const stat=lstatSync(directory);
 const root=process.env.TASK398_OWNED_280==="1"?"/run/task398-browser/jg398-browser-evidence-":"/private/tmp/jg398-browser-evidence-";
 if(!directory.startsWith(root)||realpathSync(directory)!==directory||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o700||!["receipt.json","receipt-stage2.json","receipt-complete.json"].includes(name))throw new Error("TASK398_BROWSER_EVIDENCE_DIR");
 const fd=openSync(path.join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{const file=fstatSync(fd);if(!file.isFile()||file.uid!==process.getuid?.()||(file.mode&0o777)!==0o600)throw new Error("TASK398_BROWSER_EVIDENCE_IDENTITY");io.write(fd,JSON.stringify(value)+"\n");io.sync(fd);}finally{closeSync(fd);}
 const dirfd=openSync(directory,constants.O_RDONLY);try{io.sync(dirfd);}finally{closeSync(dirfd);}
}
