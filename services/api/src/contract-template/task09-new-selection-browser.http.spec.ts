import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import PizZip from "pizzip";
import { createTemplateTestServer } from "./template-management.test-support";
import { publishMappedSelectionLayout } from "./template-selection.test-support";

describe("task09 true new contract to published Word selection in desktop and mobile", () => {
  it("uses real create, save, selectors, queue and downloadable DOCX with all production guards", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const directory = await mkdtemp(join(tmpdir(), "jg-task09-new-selection-browser-"));
    try {
      await server.store.prisma.project.create({ data: { id: randomUUID(), code: "T09-BROWSER", name: "新建手选模板合成项目", isActive: true } });
      const material = await publishMappedSelectionLayout(server, "材料业务样张");
      const other = await publishMappedSelectionLayout(server, "其他业务样张", "other");
      server.processor.onApplicationBootstrap();
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task09-new-selection.config.ts"], {
        cwd: resolve(__dirname, "../../../.."), env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TEMPLATE_BROWSER_OUTPUT: join(directory, "browser"), TASK09_NEW_SELECTION_INPUT: JSON.stringify({ material, other, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      const receipts: Array<unknown> = [];
      for (const entry of await readdir(join(directory, "browser"), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folder = join(directory, "browser", entry.name);
        if (!(await readdir(folder)).includes("receipt.json")) continue;
        const receipt = JSON.parse(await readFile(join(folder, "receipt.json"), "utf8"));
        const xml = new PizZip(await readFile(receipt.docxPath)).file("word/document.xml")!.asText();
        expect(xml).toContain("新建手选"); expect(xml).toContain("实际合同");
        expect(xml.match(/新建当前甲方/gu)).toHaveLength(2); expect(xml.match(/新建当前乙方/gu)).toHaveLength(2);
        expect(xml).toContain("本项普通约定按原文保留"); expect(xml).not.toContain("样张核对");
        receipts.push(receipt);
      }
      expect(receipts).toHaveLength(2);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ receipts, pdfVisualGate: "FAILED in current formal renderer; no font or renderer changes by task09", scope: "real desktop/mobile create and published Word selector, guarded API, actual DOCX; synthetic DB/storage" }, null, 2));
      console.info(`任务09新建手选桌面手机实际文书证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务09新建手选浏览器失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 250_000);
});
