import { performance } from "node:perf_hooks";
import { createOfficialDocumentChildBudget, attachPostcheck } from "../../prisma/task12-official-document-child.cjs";
import { CONTRACT_DOCX_ALLOWED_FONTS, LEGACY_OFFICE_ALLOWED_FONTS } from "./contract-document-font-policy";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { currentOfficialDocumentScope } from "../../prisma/task12-official-document-profile.cjs";

const execFileAsync = promisify(execFile);
export const CONVERSION_TIMEOUT_MS = 120_000;

export interface ExecFileResult {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type ExecFileRunner = (
  command: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv; cwd?: string }
) => Promise<ExecFileResult>;

export interface LibreOfficeConverterOptions {
  runner?: ExecFileRunner;
  platform?: NodeJS.Platform;
}

const defaultRunner: ExecFileRunner = async (command, args, options) => {
  const result = await execFileAsync(command, args, options);
  return { stdout: result.stdout, stderr: result.stderr };
};

function preserveOfficeFirstFailure(primary:unknown,cleanup:unknown): void {
  const preserved=attachPostcheck(primary,cleanup);
  // An extensible child error is retained exactly. Frozen errors retain the
  // original first cause through the aggregate instead of losing cleanup data.
  if(preserved!==primary)rethrowOfficeCleanup(preserved);
}
function rethrowOfficeCleanup(error:unknown):never { throw error; }
function refuseUnownedDirectory(): never {
  throw Object.assign(new Error("转换临时目录归属无法核对"), { code: "TASK12_OFFICIAL_DOCUMENT_CLEANUP_UNKNOWN" });
}

function uniqueFonts(values: readonly string[]): string[] {
  const fonts = new Map<string, string>();
  for (const value of values) {
    const font = value.trim();
    if (font) fonts.set(font.toLocaleLowerCase(), font);
  }
  return [...fonts.values()];
}

function errorProperty(cause: unknown, property: string): unknown {
  return cause && typeof cause === "object" && property in cause
    ? (cause as Record<string, unknown>)[property]
    : undefined;
}

function isTimeoutError(cause: unknown): boolean {
  return (
    errorProperty(cause, "code") === "ETIMEDOUT" ||
    errorProperty(cause, "killed") === true ||
    errorProperty(cause, "signal") === "SIGTERM"
  );
}

async function assertFontsAvailable(
  declaredFonts: readonly string[],
  runner: ExecFileRunner,
  platform: NodeJS.Platform,
  defaultAllowedFonts: string
): Promise<void> {
  const fonts = uniqueFonts(declaredFonts);
  const allowedFonts = new Set(
    uniqueFonts(
      (process.env.DOC_ALLOWED_FONTS ?? defaultAllowedFonts).split(",")
    ).map((font) => font.toLocaleLowerCase())
  );
  const disallowedFonts = fonts.filter(
    (font) => !allowedFonts.has(font.toLocaleLowerCase())
  );
  if (disallowedFonts.length) {
    throw new Error("合同文档包含不允许的字体，请按模板字体规范调整");
  }
  if (platform !== "linux") return;

  for (const font of fonts) {
    let result: ExecFileResult;
    try {
      result = await runner(
        "fc-match",
        ["--format", "%{family}", font],
        { timeout: CONVERSION_TIMEOUT_MS }
      );
    } catch {
      throw new Error("合同文档字体检查失败，请联系管理员");
    }

    const matchedFamilies = String(result.stdout ?? "")
      .split(",")
      .map((family) => family.trim().toLocaleLowerCase());
    if (!matchedFamilies.includes(font.toLocaleLowerCase())) {
      throw new Error("合同文档所需字体在转换服务中不可用，请联系管理员");
    }
  }
}

export async function convertDocxToPdf(
  docxBuffer: Buffer,
  declaredFonts: readonly string[] = [],
  options: LibreOfficeConverterOptions = {}
): Promise<Buffer> {
  return convertOfficeToPdf(docxBuffer, "docx", declaredFonts, options, "合同");
}

export async function convertXlsxToPdf(
  xlsxBuffer: Buffer,
  options: LibreOfficeConverterOptions = {}
): Promise<Buffer> {
  return convertOfficeToPdf(xlsxBuffer, "xlsx", [], options, "结算模板");
}

async function convertOfficeToPdf(
  sourceBuffer: Buffer,
  extension: "docx" | "xlsx",
  declaredFonts: readonly string[],
  options: LibreOfficeConverterOptions,
  documentLabel: "合同" | "结算模板"
): Promise<Buffer> {
  const started=performance.now();
  const official = currentOfficialDocumentScope();
  const child=official?createOfficialDocumentChildBudget(official,CONVERSION_TIMEOUT_MS,started):undefined;
  const runner = options.runner ?? defaultRunner;
  await assertFontsAvailable(
    declaredFonts,
    runner,
    options.platform ?? process.platform,
    extension === "docx" ? CONTRACT_DOCX_ALLOWED_FONTS : LEGACY_OFFICE_ALLOWED_FONTS
  );

  const tempDir = await mkdtemp(path.join(official?.temporaryDirectory ?? tmpdir(), "contract-doc-"));
  const owned = official ? await (await import("node:fs/promises")).lstat(tempDir) : undefined;
  const profilePath = path.join(tempDir, "profile");
  const inputPath = path.join(tempDir, `input.${extension}`);
  const outputPath = path.join(tempDir, "input.pdf");

  let primaryFailed=false,primary:unknown;
  try {
    await mkdir(profilePath);
    await writeFile(inputPath, sourceBuffer);
    try {
      const invoke=(timeout:number)=>runner(
        official?.libreOfficeCommand ?? process.env.DOC_CONVERTER_COMMAND ?? "soffice",
        [
          `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          tempDir,
          inputPath
        ],
        { timeout, ...(official ? { env: { ...official.libreOfficeEnv }, cwd: tempDir } : {}) }
      );
      if(child)await child.run(invoke);else await invoke(CONVERSION_TIMEOUT_MS);
    } catch (cause) {
      if (errorProperty(cause, "code") === "ENOENT") {
        throw new Error(`${documentLabel} PDF 转换服务不可用，请联系管理员`,official?{cause}:undefined);
      }
      if (isTimeoutError(cause)) {
        throw new Error(`${documentLabel} PDF 转换超时，请稍后重试`,official?{cause}:undefined);
      }
      throw new Error(`${documentLabel} PDF 转换失败，请稍后重试`,official?{cause}:undefined);
    }

    let output:Buffer;
    try {
      output=await readFile(outputPath);
    } catch(cause) {
      throw new Error(`${documentLabel} PDF 转换未生成输出文件，请稍后重试`,official?{cause}:undefined);
    }
    child?.remaining();return output;
  } catch(error) {primaryFailed=true;primary=error;throw error;
  } finally {
    try {
    if (official) {
      official.check();
      const { lstat, realpath } = await import("node:fs/promises");
      const now = await lstat(tempDir);
      if (!owned || now.isSymbolicLink() || !now.isDirectory() || await realpath(tempDir) !== tempDir ||
        now.dev !== owned.dev || now.ino !== owned.ino || now.uid !== owned.uid || now.mode !== owned.mode) {
        refuseUnownedDirectory();
      }
    }
    await rm(tempDir, { recursive: true, force: true });
    } catch(cleanupError) {
      if(!official)rethrowOfficeCleanup(cleanupError);
      if(primaryFailed)preserveOfficeFirstFailure(primary,cleanupError);
      else rethrowOfficeCleanup(cleanupError);
    }
  }
}
