import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_ALLOWED_FONTS = "Noto Sans CJK SC,宋体,仿宋,黑体";
export const CONVERSION_TIMEOUT_MS = 120_000;

export interface ExecFileResult {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type ExecFileRunner = (
  command: string,
  args: string[],
  options: { timeout: number }
) => Promise<ExecFileResult>;

export interface LibreOfficeConverterOptions {
  runner?: ExecFileRunner;
  platform?: NodeJS.Platform;
}

const defaultRunner: ExecFileRunner = async (command, args, options) => {
  const result = await execFileAsync(command, args, options);
  return { stdout: result.stdout, stderr: result.stderr };
};

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
  platform: NodeJS.Platform
): Promise<void> {
  const fonts = uniqueFonts(declaredFonts);
  const allowedFonts = new Set(
    uniqueFonts(
      (process.env.DOC_ALLOWED_FONTS ?? DEFAULT_ALLOWED_FONTS).split(",")
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
  const runner = options.runner ?? defaultRunner;
  await assertFontsAvailable(
    declaredFonts,
    runner,
    options.platform ?? process.platform
  );

  const tempDir = await mkdtemp(path.join(tmpdir(), "contract-doc-"));
  const profilePath = path.join(tempDir, "profile");
  const inputPath = path.join(tempDir, `input.${extension}`);
  const outputPath = path.join(tempDir, "input.pdf");

  try {
    await mkdir(profilePath);
    await writeFile(inputPath, sourceBuffer);
    try {
      await runner(
        process.env.DOC_CONVERTER_COMMAND ?? "soffice",
        [
          `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          tempDir,
          inputPath
        ],
        { timeout: CONVERSION_TIMEOUT_MS }
      );
    } catch (cause) {
      if (errorProperty(cause, "code") === "ENOENT") {
        throw new Error(`${documentLabel} PDF 转换服务不可用，请联系管理员`);
      }
      if (isTimeoutError(cause)) {
        throw new Error(`${documentLabel} PDF 转换超时，请稍后重试`);
      }
      throw new Error(`${documentLabel} PDF 转换失败，请稍后重试`);
    }

    try {
      return await readFile(outputPath);
    } catch {
      throw new Error(`${documentLabel} PDF 转换未生成输出文件，请稍后重试`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
