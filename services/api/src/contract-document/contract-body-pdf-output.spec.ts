import { mkdtemp, open, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readContractBodyPdfOutput } from "./contract-body-pdf-converter";

describe("public fixed-budget body PDF output adapter", () => {
  it("reads a small PDF and rejects an owned over-budget sparse file", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "jg-task10-output-budget-")));
    const normal = join(directory, "small.pdf"), sparse = join(directory, "over-budget.pdf");
    const bytes = Buffer.from("%PDF-1.7\n%%EOF\n");
    await writeFile(normal, bytes, { flag: "wx", mode: 0o600 });
    const file = await open(sparse, "wx", 0o600);
    try { await file.truncate(100_000_001); } finally { await file.close(); }
    expect(await readContractBodyPdfOutput(normal)).toEqual(bytes);
    await expect(readContractBodyPdfOutput(sparse)).rejects.toThrow("合同正文 PDF 转换失败");
    console.info(`任务10固定输出预算适配器证据：${directory}`);
  });
});
