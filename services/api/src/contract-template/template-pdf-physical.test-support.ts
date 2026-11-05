import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Test-only actual PDF gate; no Python/font paths or bytes are product dependencies. */
export function inspectActualTemplatePdf(sourceDocx: Buffer, pdf: Buffer, label: string): string {
  const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
  const manifestPath = process.env.TEMPLATE_PDF_RUNTIME_MANIFEST;
  if (!python || !manifestPath) throw new Error("Actual PDF checks require explicit TEMPLATE_PDF_INSPECTOR_PYTHON and TEMPLATE_PDF_RUNTIME_MANIFEST; no fallback/skip");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { workspace: string; artifactDirectory: string };
  // Validate the caller's owned temporary workspace before writing any artifact.
  const workspace = realpathSync(manifest.workspace), artifacts = realpathSync(manifest.artifactDirectory);
  const below = (parent: string, child: string) => { const path = relative(parent, child); return Boolean(path) && !path.startsWith("..") && !isAbsolute(path); };
  const temporaryRoots = [realpathSync(tmpdir()), ...(existsSync("/tmp") ? [realpathSync("/tmp")] : [])];
  if (!temporaryRoots.some(root => below(root, workspace)) || !below(workspace, artifacts) || dirname(realpathSync(manifestPath)) !== workspace) throw new Error("Actual PDF artifacts require an isolated temporary runtime workspace");
  const directory = mkdtempSync(join(artifacts, "physical-"));
  const sourcePath = join(directory, "source.docx"), pdfPath = join(directory, "actual.pdf");
  writeFileSync(sourcePath, sourceDocx); writeFileSync(pdfPath, pdf);
  writeFileSync(join(directory, "label.txt"), label);
  const result = spawnSync(python, [resolve(__dirname, "../../test-support/inspect-contract-pdf-physical.py"), sourcePath, pdfPath, join(directory, "receipt.json"), manifestPath], { encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  writeFileSync(join(directory, "inspection.log"), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (result.status !== 0) throw new Error(`Actual PDF physical glyph check failed (${label}); receipt ${directory}; ${result.stdout ?? ""}${result.stderr ?? ""}`);
  const text = result.stdout.split("---SEMANTIC-TEXT---\n")[1];
  if (text === undefined) throw new Error(`Actual PDF inspector omitted semantic output; receipt ${directory}`);
  console.info(`Actual PDF physical receipt: ${directory}`);
  return text;
}
