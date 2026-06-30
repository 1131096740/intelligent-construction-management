import { access, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONVERSION_TIMEOUT_MS,
  convertDocxToPdf,
  type ExecFileRunner
} from "./libreoffice-converter";

describe("LibreOffice converter", () => {
  const originalCommand = process.env.DOC_CONVERTER_COMMAND;
  const originalAllowedFonts = process.env.DOC_ALLOWED_FONTS;

  afterEach(() => {
    if (originalCommand === undefined) delete process.env.DOC_CONVERTER_COMMAND;
    else process.env.DOC_CONVERTER_COMMAND = originalCommand;
    if (originalAllowedFonts === undefined) delete process.env.DOC_ALLOWED_FONTS;
    else process.env.DOC_ALLOWED_FONTS = originalAllowedFonts;
  });

  it("calls LibreOffice with exact headless PDF conversion arguments", async () => {
    process.env.DOC_CONVERTER_COMMAND = "/opt/libreoffice/soffice";
    process.env.DOC_ALLOWED_FONTS = "Noto Sans CJK SC";
    const calls: Array<{
      command: string;
      args: string[];
      options: { timeout: number };
    }> = [];
    let tempDir = "";
    const runner: ExecFileRunner = async (command, args, options) => {
      calls.push({ command, args, options });
      tempDir = args[5];
      expect(await readFile(args[6])).toEqual(Buffer.from("docx"));
      await writeFile(path.join(tempDir, "input.pdf"), Buffer.from("%PDF-result"));
      return {};
    };

    const result = await convertDocxToPdf(
      Buffer.from("docx"),
      ["Noto Sans CJK SC"],
      { runner, platform: "darwin" }
    );

    expect(result).toEqual(Buffer.from("%PDF-result"));
    expect(calls).toEqual([
      {
        command: "/opt/libreoffice/soffice",
        args: [
          `-env:UserInstallation=${pathToFileURL(path.join(tempDir, "profile")).href}`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          tempDir,
          path.join(tempDir, "input.docx")
        ],
        options: { timeout: CONVERSION_TIMEOUT_MS }
      }
    ]);
    await expect(access(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks trimmed unique declared fonts with fc-match on Linux", async () => {
    process.env.DOC_CONVERTER_COMMAND = "soffice";
    process.env.DOC_ALLOWED_FONTS = "宋体, Noto Sans CJK SC";
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: ExecFileRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "fc-match") {
        return { stdout: args[2] };
      }
      await writeFile(path.join(args[5], "input.pdf"), Buffer.from("%PDF"));
      return {};
    };

    await convertDocxToPdf(
      Buffer.from("docx"),
      [" 宋体 ", "宋体", "Noto Sans CJK SC"],
      { runner, platform: "linux" }
    );

    expect(calls.slice(0, 2)).toEqual([
      { command: "fc-match", args: ["--format", "%{family}", "宋体"] },
      {
        command: "fc-match",
        args: ["--format", "%{family}", "Noto Sans CJK SC"]
      }
    ]);
    expect(calls[2]?.command).toBe("soffice");
  });

  it("compares allowed, declared, and host font names case-insensitively", async () => {
    process.env.DOC_ALLOWED_FONTS = " noto SANS cjk sc ";
    const runner: ExecFileRunner = async (command, args) => {
      if (command === "fc-match") return { stdout: "NOTO SANS CJK SC" };
      await writeFile(path.join(args[5], "input.pdf"), Buffer.from("%PDF"));
      return {};
    };

    await expect(
      convertDocxToPdf(Buffer.from("docx"), [" Noto Sans CJK SC "], {
        runner,
        platform: "linux"
      })
    ).resolves.toEqual(Buffer.from("%PDF"));
  });

  it("rejects declared fonts outside DOC_ALLOWED_FONTS on every platform", async () => {
    process.env.DOC_ALLOWED_FONTS = "宋体";
    const runner = jest.fn<ReturnType<ExecFileRunner>, Parameters<ExecFileRunner>>();

    await expect(
      convertDocxToPdf(Buffer.from("docx"), [" 仿宋 "], {
        runner,
        platform: "darwin"
      })
    ).rejects.toThrow("Disallowed document fonts: 仿宋");
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects an allowed font unavailable on the Linux conversion host", async () => {
    process.env.DOC_ALLOWED_FONTS = "宋体";
    const runner: ExecFileRunner = async () => ({ stdout: "DejaVu Sans" });

    await expect(
      convertDocxToPdf(Buffer.from("docx"), ["宋体"], {
        runner,
        platform: "linux"
      })
    ).rejects.toThrow("Document font is unavailable on conversion host: 宋体");
  });

  it("returns a clear error with cause when the converter executable is missing", async () => {
    const cause = Object.assign(new Error("spawn soffice ENOENT"), { code: "ENOENT" });
    const runner: ExecFileRunner = async () => {
      throw cause;
    };

    const conversion = convertDocxToPdf(Buffer.from("docx"), [], {
      runner,
      platform: "darwin"
    });

    await expect(conversion).rejects.toThrow(
      "DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path."
    );
    await expect(conversion).rejects.toMatchObject({ cause });
  });

  it("returns a clear error with cause on nonzero converter exit and cleans temp files", async () => {
    const cause = Object.assign(new Error("conversion failed"), { code: 1 });
    let tempDir = "";
    const runner: ExecFileRunner = async (_command, args) => {
      tempDir = args[5];
      throw cause;
    };

    const conversion = convertDocxToPdf(Buffer.from("docx"), [], {
      runner,
      platform: "darwin"
    });

    await expect(conversion).rejects.toThrow("LibreOffice PDF conversion failed");
    await expect(conversion).rejects.toMatchObject({ cause });
    await expect(access(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { killed: true },
    { code: "ETIMEDOUT" },
    { signal: "SIGTERM" }
  ])("returns a clear timeout error with cause for %o", async (timeoutDetails) => {
    const cause = Object.assign(new Error("conversion stopped"), timeoutDetails);
    let tempDir = "";
    const runner: ExecFileRunner = async (_command, args) => {
      tempDir = args[5];
      throw cause;
    };

    const conversion = convertDocxToPdf(Buffer.from("docx"), [], {
      runner,
      platform: "darwin"
    });

    await expect(conversion).rejects.toThrow(
      "LibreOffice PDF conversion timed out after 120 seconds"
    );
    await expect(conversion).rejects.toMatchObject({ cause });
    await expect(access(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a clear error when LibreOffice produces no PDF and cleans temp files", async () => {
    let tempDir = "";
    const runner: ExecFileRunner = async (_command, args) => {
      tempDir = args[5];
      return {};
    };

    const conversion = convertDocxToPdf(Buffer.from("docx"), [], {
      runner,
      platform: "darwin"
    });

    await expect(conversion).rejects.toThrow(
      "LibreOffice PDF conversion did not produce input.pdf"
    );
    await expect(access(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
