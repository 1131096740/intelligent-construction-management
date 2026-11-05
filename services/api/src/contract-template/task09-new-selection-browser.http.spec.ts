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
    const fontDir = process.env.TASK09_PDF_FONT_DIR;
    if (!fontDir) throw new Error("任务09完整PDF门需要主控确认的私有锁定字体目录，不能以文本提取代替物理字形检查");
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
        const physicalDirectory = join(folder, "pdf-physical");
        const inspected = await promisify(execFile)(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON ?? "python3", [
          resolve(__dirname, "task09-pdf-physical-inspector.py"), "--docx", receipt.docxPath,
          "--pdf", receipt.pdfPath, "--font-dir", fontDir, "--out-dir", physicalDirectory
        ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
        await writeFile(join(folder, "pdf-physical-inspection.log"), inspected.stdout + inspected.stderr);
        const physical = JSON.parse(await readFile(join(physicalDirectory, "receipt.json"), "utf8"));
        expect(physical.verdict).toBe("GREEN"); expect(physical.failures).toEqual([]);
        expect(physical.pdfSha256).toBe(receipt.pdfSha256);
        receipts.push({ ...receipt, pdfVisualGate: "Physical glyph predicates GREEN; raster pending human review", physicalReceipt: join(physicalDirectory, "receipt.json") });
      }
      expect(receipts).toHaveLength(2);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ receipts, pdfVisualGate: "Physical glyph predicates GREEN for both public PDF downloads; rasters require human review", runtimeScope: "child FONTCONFIG_FILE plus task-owned pinned fonts/cache only; product renderer and source DOCX unchanged", scope: "real desktop/mobile create and published Word selector, guarded API, actual DOCX/PDF; synthetic DB/storage" }, null, 2));
      console.info(`任务09新建手选桌面手机实际文书证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务09新建手选浏览器失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 250_000);
});
