import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export function pdfPublicTextItems(buffer: Buffer) {
  const pdfjs = require.resolve("pdfjs-dist/legacy/build/pdf.mjs", {paths: [resolve(__dirname, "../../../../apps/web-admin")]});
  const parsed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {pathToFileURL} from "node:url";
    const {getDocument} = await import(pathToFileURL(process.argv[1]).href);
    const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
    const task=getDocument({data:new Uint8Array(Buffer.concat(chunks)),verbosity:0}); const doc=await task.promise;
    const items=[];
    for(let page=1;page<=doc.numPages;page++) {
      const content=await (await doc.getPage(page)).getTextContent();
      for(const item of content.items) if("str" in item) items.push({page,text:item.str,x:item.transform[4],y:item.transform[5]});
    }
    process.stdout.write(JSON.stringify(items)); await task.destroy();
  `, pdfjs], {input: buffer, maxBuffer: 4 * 1024 * 1024});
  if (parsed.status !== 0) throw new Error(`PDF公开输出坐标解析失败：${parsed.stderr.toString()}`);
  const items = JSON.parse(parsed.stdout.toString()) as Array<{page:number;text:string;x:number;y:number}>;
  return items;
}
