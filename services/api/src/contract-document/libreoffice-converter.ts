import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_ALLOWED_FONTS = "Noto Sans CJK SC,宋体,仿宋,黑体";

export interface ExecFileResult {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type ExecFileRunner = (
  command: string,
  args: string[]
) => Promise<ExecFileResult>;

export interface LibreOfficeConverterOptions {
  runner?: ExecFileRunner;
  platform?: NodeJS.Platform;
}

const defaultRunner: ExecFileRunner = async (command, args) => {
  const result = await execFileAsync(command, args);
  return { stdout: result.stdout, stderr: result.stderr };
};

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function errorCode(cause: unknown): unknown {
  return cause && typeof cause === "object" && "code" in cause
    ? cause.code
    : undefined;
}

async function assertFontsAvailable(
  declaredFonts: readonly string[],
  runner: ExecFileRunner,
  platform: NodeJS.Platform
): Promise<void> {
  const fonts = uniqueTrimmed(declaredFonts);
  const allowedFonts = new Set(
    uniqueTrimmed(
      (process.env.DOC_ALLOWED_FONTS ?? DEFAULT_ALLOWED_FONTS).split(",")
    )
  );
  const disallowedFonts = fonts.filter((font) => !allowedFonts.has(font));
  if (disallowedFonts.length) {
    throw new Error(`Disallowed document fonts: ${disallowedFonts.join(", ")}`);
  }
  if (platform !== "linux") return;

  for (const font of fonts) {
    let result: ExecFileResult;
    try {
      result = await runner("fc-match", ["--format", "%{family}", font]);
    } catch (cause) {
      throw new Error(`Failed to verify document font on conversion host: ${font}`, {
        cause
      });
    }

    const matchedFamilies = String(result.stdout ?? "")
      .split(",")
      .map((family) => family.trim().toLocaleLowerCase());
    if (!matchedFamilies.includes(font.toLocaleLowerCase())) {
      throw new Error(`Document font is unavailable on conversion host: ${font}`);
    }
  }
}

export async function convertDocxToPdf(
  docxBuffer: Buffer,
  declaredFonts: readonly string[] = [],
  options: LibreOfficeConverterOptions = {}
): Promise<Buffer> {
  const runner = options.runner ?? defaultRunner;
  await assertFontsAvailable(
    declaredFonts,
    runner,
    options.platform ?? process.platform
  );

  const tempDir = await mkdtemp(path.join(tmpdir(), "contract-doc-"));
  const inputPath = path.join(tempDir, "input.docx");
  const outputPath = path.join(tempDir, "input.pdf");

  try {
    await writeFile(inputPath, docxBuffer);
    try {
      await runner(process.env.DOC_CONVERTER_COMMAND ?? "soffice", [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        tempDir,
        inputPath
      ]);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") {
        throw new Error(
          "DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path.",
          { cause }
        );
      }
      throw new Error("LibreOffice PDF conversion failed", { cause });
    }

    try {
      return await readFile(outputPath);
    } catch (cause) {
      throw new Error("LibreOffice PDF conversion did not produce input.pdf", {
        cause
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
