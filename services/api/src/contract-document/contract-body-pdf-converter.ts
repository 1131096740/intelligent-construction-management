import { performance } from "node:perf_hooks";
import { createOfficialDocumentChildBudget, attachPostcheck } from "../../prisma/task12-official-document-child.cjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, delimiter } from "node:path";
import { promisify } from "node:util";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { extractContractDocx } from "./contract-docx-extractor";
import { finalizeContractBodyLineBoxScope, isReviewedTypographyVersion, REVIEWED_MATERIAL_SOURCE_SHA256, REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION,
  type ContractBodyLineBoxScope, type ReviewedTypographyVersion } from "./contract-body-document";

import { currentOfficialDocumentScope } from "../../prisma/task12-official-document-profile.cjs";

const exec = promisify(execFile);
const HASH = /^[a-f0-9]{64}$/u;
const RUNTIME_ERROR = "合同正文转换运行环境未就绪，请联系管理员";
const CONVERSION_ERROR = "合同正文 PDF 转换失败，请联系管理员核对保留的转换记录";
const SOURCE_ERROR = "合同正文文件无法安全转换，请核对文件内容";
const ASSETS = resolve(__dirname, "../../assets/document-converter");
const ENGINE = "docx4j-17.3.5-jdk17";
const TIMEOUT_MS = 120_000;
const PDF_BYTE_LIMIT = 100_000_000;
const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SCOPE_BYTE_LIMIT = 256_000;
const LEGACY_LOCK_SHA256 = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const LEGACY_RUNTIME = { lockName: "runtime-lock.json", sourceName: "ContractDocxPdf.java", manifestEnvironment: "CONTRACT_DOCX4J_RUNTIME_MANIFEST", scopedBody25: false } as const;
const MATERIAL_BODY25_RUNTIME = { lockName: "runtime-lock-material-body25-v4.json", sourceName: "material-body25-v4/ContractDocxPdf.java",
  manifestEnvironment: "CONTRACT_MATERIAL_BODY25_DOCX4J_RUNTIME_MANIFEST", scopedBody25: true } as const;
const ACTIVE_FIELD = /INCLUDETEXT|INCLUDEPICTURE|DDE|HYPERLINK|DATABASE|\bLINK\b/iu;

interface LockedFile { name: string; sha256: string }
interface RuntimeLock {
  schemaVersion: 1; engine: string; adapterSourceSha256: string;
  jdkTreeSha256: string; jdkTreeEntries: number;
  jars: LockedFile[]; classes: LockedFile[]; fonts: LockedFile[];
}
interface RuntimeManifest {
  schemaVersion: 1; engine: string; jdkHome: string; scratchDirectory: string;
  jars: Array<{ name: string; path: string }>;
  classes: Array<{ name: string; path: string }>;
  fonts: Array<{ name: string; path: string }>;
}

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function below(parent: string, child: string) {
  const value = relative(parent, child);
  return Boolean(value) && !value.startsWith("..") && !isAbsolute(value);
}

async function regular(path: string) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error(RUNTIME_ERROR);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error(RUNTIME_ERROR);
}

async function jsonFile(path: string) {
  await regular(path);
  if ((await lstat(path)).size > 256_000) throw new Error(RUNTIME_ERROR);
  const bytes = await readFile(path);
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(RUNTIME_ERROR);
  return { value: value as Record<string, unknown>, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function runtimeDescriptor(typographyVersion?: ReviewedTypographyVersion) {
  if (typographyVersion !== undefined && !isReviewedTypographyVersion(typographyVersion)) throw new Error(RUNTIME_ERROR);
  return typographyVersion === REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION ? MATERIAL_BODY25_RUNTIME : LEGACY_RUNTIME;
}

async function lockFile(typographyVersion?: ReviewedTypographyVersion) {
  const official = currentOfficialDocumentScope();
  if (official && typographyVersion !== REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION) throw new Error(RUNTIME_ERROR);
  const descriptor = official ? { ...MATERIAL_BODY25_RUNTIME, lockName: official.lockName } : runtimeDescriptor(typographyVersion);
  const loaded = await jsonFile(join(ASSETS, descriptor.lockName));
  const lock = loaded.value as unknown as RuntimeLock;
  if (lock.schemaVersion !== 1 || lock.engine !== ENGINE || !HASH.test(lock.adapterSourceSha256) || !HASH.test(lock.jdkTreeSha256) || lock.jdkTreeEntries !== 456) throw new Error(RUNTIME_ERROR);
  const classCount = descriptor.scopedBody25 && Array.isArray(lock.classes) ? lock.classes.length : 3;
  if (classCount < 1) throw new Error(RUNTIME_ERROR);
  for (const [items, count] of [[lock.jars, 2], [lock.classes, classCount], [lock.fonts, 10]] as const) {
    if (!Array.isArray(items) || items.length !== count || items.some(item => !item || typeof item.name !== "string" || !HASH.test(item.sha256)) || new Set(items.map(item => item.name)).size !== count) throw new Error(RUNTIME_ERROR);
  }
  if (official) {
    official.check();
    if (loaded.sha256 !== official.lockSha256) throw new Error(RUNTIME_ERROR);
  } else if (descriptor.scopedBody25) {
    const legacy = await jsonFile(join(ASSETS, LEGACY_RUNTIME.lockName));
    if (legacy.sha256 !== LEGACY_LOCK_SHA256 || loaded.sha256 === LEGACY_LOCK_SHA256 ||
      Object.keys(loaded.value).some(key => !["schemaVersion", "engine", "adapterSourceSha256", "jdkTreeSha256", "jdkTreeEntries", "jars", "classes", "fonts"].includes(key)) ||
      lock.jdkTreeSha256 !== legacy.value.jdkTreeSha256 || lock.jdkTreeEntries !== legacy.value.jdkTreeEntries ||
      JSON.stringify(lock.jars) !== JSON.stringify(legacy.value.jars) || JSON.stringify(lock.fonts) !== JSON.stringify(legacy.value.fonts) ||
      !lock.classes.some(item => item.name === "ContractDocxPdf.class") || lock.classes.some(item => !/^ContractDocxPdf(?:\$[A-Za-z0-9_]+)*\.class$/u.test(item.name))) throw new Error(RUNTIME_ERROR);
  } else if (loaded.sha256 !== LEGACY_LOCK_SHA256) throw new Error(RUNTIME_ERROR);
  const source = join(ASSETS, descriptor.sourceName); await regular(source);
  if (await digest(source) !== lock.adapterSourceSha256) throw new Error(RUNTIME_ERROR);
  return { lock, sha256: loaded.sha256, descriptor };
}

/** Stored server profile selects one trusted descriptor; old jobs never infer a current profile. */
export async function contractBodyPdfRuntimeLockFingerprint(typographyVersion?: ReviewedTypographyVersion) {
  try { return (await lockFile(typographyVersion)).sha256; } catch { throw new Error(RUNTIME_ERROR); }
}

export async function assertContractBodyPdfRuntimeLock(expected: string, typographyVersion?: ReviewedTypographyVersion) {
  if (!HASH.test(expected) || await contractBodyPdfRuntimeLockFingerprint(typographyVersion) !== expected) throw new Error(RUNTIME_ERROR);
}

async function jdkTree(root: string) {
  if (typeof root !== "string" || !isAbsolute(root) || await realpath(root) !== resolve(root) || !(await lstat(root)).isDirectory()) throw new Error(RUNTIME_ERROR);
  const rows: Array<[string, string, string, number?]> = [];
  let members = 0;
  async function walk(folder: string) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (++members > 2_000) throw new Error(RUNTIME_ERROR);
      const path = join(folder, item.name), name = relative(root, path);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        if (!below(root, await realpath(path))) throw new Error(RUNTIME_ERROR);
        rows.push([name, "link", await readlink(path)]);
      } else if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) rows.push([name, "file", await digest(path), stat.mode & 0o7777]);
      else throw new Error(RUNTIME_ERROR);
    }
  }
  await walk(root);
  // Match the approved Python pathlib order: compare path components, so
  // java.management sorts before java.management.rmi (not '/' versus '.').
  rows.sort((left, right) => {
    const a = left[0].split("/"), b = right[0].split("/");
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    }
    return a.length - b.length;
  });
  return { sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), count: rows.length };
}

async function files(actual: RuntimeManifest["fonts"], expected: LockedFile[]) {
  if (!Array.isArray(actual) || actual.length !== expected.length || new Set(actual.map(item => item?.name)).size !== expected.length) throw new Error(RUNTIME_ERROR);
  const paths: string[] = [];
  for (const approved of expected) {
    const item = actual.find(item => item?.name === approved.name);
    if (!item) throw new Error(RUNTIME_ERROR);
    await regular(item.path);
    if (await digest(item.path) !== approved.sha256) throw new Error(RUNTIME_ERROR);
    paths.push(item.path);
  }
  return paths;
}

async function loadRuntime(expectedLockSha256: string, typographyVersion?: ReviewedTypographyVersion) {
  try {
    const locked = await lockFile(typographyVersion);
    if (locked.sha256 !== expectedLockSha256) throw new Error(RUNTIME_ERROR);
    const official = currentOfficialDocumentScope();
    const manifestPath = official?.manifestPath ?? process.env[locked.descriptor.manifestEnvironment];
    if (!manifestPath) throw new Error(RUNTIME_ERROR);
    const loaded = await jsonFile(manifestPath), manifest = loaded.value as unknown as RuntimeManifest;
    if (official && loaded.sha256 !== official.manifestSha256) throw new Error(RUNTIME_ERROR);
    if (Object.keys(loaded.value).some(key => !["schemaVersion", "engine", "jdkHome", "scratchDirectory", "jars", "classes", "fonts"].includes(key)) || manifest.schemaVersion !== 1 || manifest.engine !== ENGINE) throw new Error(RUNTIME_ERROR);
    const jdk = await jdkTree(manifest.jdkHome);
    if (jdk.sha256 !== locked.lock.jdkTreeSha256 || jdk.count !== locked.lock.jdkTreeEntries) throw new Error(RUNTIME_ERROR);
    const [jars, classes, fonts] = await Promise.all([files(manifest.jars, locked.lock.jars), files(manifest.classes, locked.lock.classes), files(manifest.fonts, locked.lock.fonts)]);
    if (typeof manifest.scratchDirectory !== "string" || !isAbsolute(manifest.scratchDirectory) || await realpath(manifest.scratchDirectory) !== resolve(manifest.scratchDirectory) || !(await lstat(manifest.scratchDirectory)).isDirectory() || !below(dirname(manifestPath), manifest.scratchDirectory)) throw new Error(RUNTIME_ERROR);
    official?.check();
    return { manifest, manifestSha256: loaded.sha256, lock: locked.lock, lockSha256: locked.sha256, descriptor: locked.descriptor, jars, classes, fonts, official };
  } catch { throw new Error(RUNTIME_ERROR); }
}

function validateWord(bytes: Buffer) {
  try {
    extractContractDocx(bytes); // Existing archive/entry/XML/nesting limits remain.
    const zip = new PizZip(bytes);
    let expandedBytes = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const value = entry.asUint8Array();
      expandedBytes += value.length;
      if (expandedBytes > 20_000_000) throw new Error(SOURCE_ERROR);
      if (!/\.(xml|rels)$/iu.test(entry.name)) continue;
      const text = Buffer.from(value).toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/iu.test(text)) throw new Error(SOURCE_ERROR);
      const parsed = new DOMParser({ onError: () => { throw new Error(SOURCE_ERROR); } }).parseFromString(text, "application/xml");
      const fields: Array<{ instruction: string; readingInstruction: boolean }> = [];
      const checkInstruction = (instruction: string) => { if (ACTIVE_FIELD.test(instruction)) throw new Error(SOURCE_ERROR); };
      for (const item of Array.from(parsed.getElementsByTagName("*"))) {
        if (item.localName === "Relationship") {
          const target = item.getAttribute("Target") ?? "";
          if ((item.getAttribute("TargetMode") ?? "").toLowerCase() === "external" || target.includes(":") || target.startsWith("//")) throw new Error(SOURCE_ERROR);
        }
        if (item.namespaceURI !== WORD_NAMESPACE) continue;
        if (item.localName === "fldSimple") checkInstruction(item.getAttributeNS(WORD_NAMESPACE, "instr") ?? "");
        if (item.localName === "fldChar") {
          const kind = item.getAttributeNS(WORD_NAMESPACE, "fldCharType");
          if (kind === "begin") fields.push({ instruction: "", readingInstruction: true });
          else if (kind === "separate" || kind === "end") {
            const field = fields.at(-1);
            if (field) { checkInstruction(field.instruction); field.readingInstruction = false; }
            if (kind === "end") fields.pop();
          }
        }
        if (item.localName === "instrText") {
          const instruction = item.textContent ?? "";
          checkInstruction(instruction);
          const field = fields.at(-1);
          if (field?.readingInstruction) field.instruction += instruction;
        }
      }
      for (const field of fields) checkInstruction(field.instruction);
    }
  } catch { throw new Error(SOURCE_ERROR); }
}

function policy(runtime: Awaited<ReturnType<typeof loadRuntime>>, scratch: string) {
  const permissions = [[scratch, "read"], [join(scratch, "-"), "read,write,delete"], [join(runtime.manifest.jdkHome, "-"), "read"],
    ...runtime.jars.map(path => [path, "read"]), ...runtime.fonts.map(path => [path, "read"])];
  const lines = permissions.map(([path, actions]) => `  permission java.io.FilePermission ${JSON.stringify(path)}, "${actions}";`);
  lines.push('  permission java.util.PropertyPermission "*", "read,write";', '  permission java.lang.reflect.ReflectPermission "suppressAccessChecks";');
  for (const name of ["getClassLoader", "setContextClassLoader", "createClassLoader", "accessDeclaredMembers", "getProtectionDomain", "loadLibrary.fontmanager", "loadLibrary.awt", "loadLibrary.awt_headless"]) lines.push(`  permission java.lang.RuntimePermission "${name}";`);
  return `grant {\n${lines.join("\n")}\n};\n`;
}

/** Fixed-budget output adapter shared by the converter and offline verification CLI. */
export async function readContractBodyPdfOutput(path: string): Promise<Buffer> {
  await regular(path);
  if ((await lstat(path)).size > PDF_BYTE_LIMIT) throw new Error(CONVERSION_ERROR);
  const chunks: Buffer[] = [];
  let pdfBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    pdfBytes += value.length;
    if (pdfBytes > PDF_BYTE_LIMIT) throw new Error(CONVERSION_ERROR);
    chunks.push(value);
  }
  const pdf = Buffer.concat(chunks, pdfBytes);
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(CONVERSION_ERROR);
  return pdf;
}

function materialBody25ScopeXml(bytes: Buffer, scope: ContractBodyLineBoxScope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.keys(scope).length !== 5 ||
    Object.keys(scope).some(key => !["version", "typographyVersion", "sourceSha256", "paragraphs", "docxSha256"].includes(key)) || !HASH.test(scope.docxSha256)) throw new Error(SOURCE_ERROR);
  const { docxSha256, ...draft } = scope;
  const checked = finalizeContractBodyLineBoxScope(bytes, draft);
  if (checked.docxSha256 !== docxSha256) throw new Error(SOURCE_ERROR);
  const document = new DOMParser().parseFromString("<bodyLineBoxScope/>", "application/xml"), root = document.documentElement;
  if (!root) throw new Error(SOURCE_ERROR);
  for (const [name, value] of Object.entries({ version: "1", typographyVersion: checked.typographyVersion, sourceSha256: checked.sourceSha256,
    docxSha256, count: String(checked.paragraphs.length) })) root.setAttribute(name, value);
  for (const paragraph of checked.paragraphs) {
    const element = document.createElement("paragraph");
    for (const [name, value] of Object.entries({ ordinal: String(paragraph.ordinal), positionId: paragraph.positionId, textSha256: paragraph.textSha256 })) element.setAttribute(name, value);
    root.appendChild(element);
  }
  const xml = Buffer.from(new XMLSerializer().serializeToString(document), "utf8");
  if (xml.length > SCOPE_BYTE_LIMIT) throw new Error(SOURCE_ERROR);
  return { scope: checked, xml, sha256: createHash("sha256").update(xml).digest("hex") };
}

async function materialBody25Proof(path: string, expected: ReturnType<typeof materialBody25ScopeXml>, runtime: Awaited<ReturnType<typeof loadRuntime>>) {
  await regular(path);
  if ((await lstat(path)).size > SCOPE_BYTE_LIMIT) throw new Error(CONVERSION_ERROR);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
    if (size > SCOPE_BYTE_LIMIT) throw new Error(CONVERSION_ERROR); chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks, size), xml = bytes.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error(CONVERSION_ERROR);
  const document = new DOMParser({ onError: () => { throw new Error(CONVERSION_ERROR); } }).parseFromString(xml, "application/xml");
  const root = document.documentElement;
  const attrs = (element: Element, names: readonly string[]) => {
    const attributes = Array.from(element.attributes);
    if (attributes.length !== names.length) throw new Error(CONVERSION_ERROR);
    const result: Record<string, string> = {};
    for (const attribute of attributes) {
      const name = attribute.localName;
      if (attribute.namespaceURI || !name || !names.includes(name)) throw new Error(CONVERSION_ERROR);
      result[name] = attribute.value;
    }
    return result;
  };
  const children = (element: Element) => {
    const result: Element[] = [];
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 1 && !(node as Element).namespaceURI) result.push(node as Element);
      else if (node.nodeType !== 3 || node.nodeValue?.trim()) throw new Error(CONVERSION_ERROR);
    }
    return result;
  };
  const integer = (value: string) => { const number = Number(value); if (!/^(?:0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(number)) throw new Error(CONVERSION_ERROR); return number; };
  const positive = (value: string) => { const number = Number(value); if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) || !Number.isFinite(number) || number <= 0) throw new Error(CONVERSION_ERROR); return number; };
  if (!root || root.namespaceURI || root.localName !== "bodyLineBoxProof") throw new Error(CONVERSION_ERROR);
  const info = attrs(root, ["version", "typographyVersion", "sourceSha256", "scopeSha256", "docxSha256", "count", "lineBoxPt", "lineRule", "sentinelRemaining", "nonTargetFoSemanticsUnchanged", "comparisonStage", "instrumentationEffects", "baselineMetricKind"]);
  if (info.version !== "1" || info.typographyVersion !== REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION || info.sourceSha256 !== REVIEWED_MATERIAL_SOURCE_SHA256 ||
    info.scopeSha256 !== expected.sha256 || info.docxSha256 !== expected.scope.docxSha256 || integer(info.count) !== expected.scope.paragraphs.length ||
    info.lineBoxPt !== "25" || info.lineRule !== "exact" || info.sentinelRemaining !== "0" || info.nonTargetFoSemanticsUnchanged !== "true" ||
    info.comparisonStage !== "post-word-layout-fixups-pre-delegate" || info.instrumentationEffects !== "NOT_INDEPENDENTLY_PROVEN" || info.baselineMetricKind !== "WORD_BLOCK_FAMILY_BASE") throw new Error(CONVERSION_ERROR);
  const groups = children(root);
  if (groups.length !== 2 || groups[0].localName !== "metrics" || groups[1].localName !== "paragraphs") throw new Error(CONVERSION_ERROR);
  attrs(groups[0], []); attrs(groups[1], []);
  const metrics = new Map<string, number>(), fontIndices = new Set<number>();
  for (const element of children(groups[0])) {
    if (element.localName !== "metric" || children(element).length) throw new Error(CONVERSION_ERROR);
    const value = attrs(element, ["id", "metricFontIndex", "family", "winAscent", "winDescent", "baselinePt", "metricOrigin"]), fontIndex = integer(value.metricFontIndex);
    if (!/^m(?:0|[1-9]\d*)$/u.test(value.id) || metrics.has(value.id) || fontIndices.has(fontIndex) || fontIndex >= runtime.lock.fonts.length ||
      !value.family.trim() || Buffer.byteLength(value.family, "utf8") > 128 || value.metricOrigin !== "locked-physical-ttf" || positive(value.baselinePt) > 25) throw new Error(CONVERSION_ERROR);
    positive(value.winAscent); positive(value.winDescent); metrics.set(value.id, fontIndex); fontIndices.add(fontIndex);
  }
  const entries = children(groups[1]), usedMetrics = new Set<string>(), blocks = new Set<number>();
  if (entries.length !== expected.scope.paragraphs.length || metrics.size > 10) throw new Error(CONVERSION_ERROR);
  for (const [index, element] of entries.entries()) {
    if (element.localName !== "paragraph" || children(element).length) throw new Error(CONVERSION_ERROR);
    const entry = attrs(element, ["index", "ordinal", "foBlockOrdinal", "metricId"]), block = integer(entry.foBlockOrdinal);
    if (integer(entry.index) !== index || integer(entry.ordinal) !== expected.scope.paragraphs[index].ordinal || !metrics.has(entry.metricId) || blocks.has(block)) throw new Error(CONVERSION_ERROR);
    usedMetrics.add(entry.metricId); blocks.add(block);
  }
  if (usedMetrics.size !== metrics.size) throw new Error(CONVERSION_ERROR);
  return { docxSha256: expected.scope.docxSha256, scopeSha256: expected.sha256, proofSha256: createHash("sha256").update(bytes).digest("hex"), count: entries.length, baselineMetricFiles: metrics.size, baselineMetricKind: info.baselineMetricKind,
    comparisonStage: info.comparisonStage, instrumentationEffects: info.instrumentationEffects };
}

export async function convertContractBodyDocxToPdf(bytes: Buffer, expectedRuntimeLockSha256: string,
  options: { typographyVersion?: ReviewedTypographyVersion; lineBoxScope?: ContractBodyLineBoxScope } = {}) {
  const started=performance.now();
  const official=currentOfficialDocumentScope();
  const child=official?createOfficialDocumentChildBudget(official,TIMEOUT_MS,started):undefined;
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => !["typographyVersion", "lineBoxScope"].includes(key))) throw new Error(RUNTIME_ERROR);
  const runtime = await loadRuntime(expectedRuntimeLockSha256, options.typographyVersion);
  validateWord(bytes);
  if (runtime.descriptor.scopedBody25 !== Boolean(options.lineBoxScope)) throw new Error(RUNTIME_ERROR);
  const scoped = runtime.descriptor.scopedBody25 && options.lineBoxScope ? materialBody25ScopeXml(bytes, options.lineBoxScope) : undefined;
  const scratch = await mkdtemp(join(runtime.manifest.scratchDirectory, "conversion-"));
  for (const name of ["classes", "home", "tmp"]) await mkdir(join(scratch, name), { mode: 0o700 });
  const input = join(scratch, "input.docx"), output = join(scratch, "output.pdf"), policyPath = join(scratch, "offline.policy");
  await writeFile(input, bytes, { mode: 0o600 });
  const scopePath = join(scratch, "body25-scope.xml"), proofPath = join(scratch, "body25-scope-proof.xml");
  if (scoped) await writeFile(scopePath, scoped.xml, { mode: 0o600, flag: "wx" });
  for (let index = 0; index < runtime.classes.length; index++) {
    const target = join(scratch, "classes", runtime.lock.classes[index].name);
    await copyFile(runtime.classes[index], target);
    if (await digest(target) !== runtime.lock.classes[index].sha256) throw new Error(RUNTIME_ERROR);
  }
  await writeFile(policyPath, policy(runtime, scratch), { mode: 0o600 });
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  // No inherited JVM options, agents, loader variables, classpath or font search.
  const environment = { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TMPDIR: join(scratch, "tmp") };
  const args = ["-Xmx768m", "-XX:MaxDirectMemorySize=128m", "-XX:MaxMetaspaceSize=192m", "-Xss1m", "-Djava.security.manager", `-Djava.security.policy==${policyPath}`, `-Duser.home=${join(scratch, "home")}`, `-Djava.io.tmpdir=${join(scratch, "tmp")}`,
    "-Djava.awt.headless=true", "-Djavax.xml.accessExternalDTD=", "-Djavax.xml.accessExternalSchema=", "-Djavax.xml.accessExternalStylesheet=file,jar", "-cp", [join(scratch, "classes"), ...runtime.jars].join(delimiter), "ContractDocxPdf", input, output, ...runtime.fonts, ...(scoped ? ["body25-scope-v1", scopePath] : [])];
  const receipt = { engine: ENGINE, sourceSha256, runtimeLockSha256: runtime.lockSha256, runtimeManifestSha256: runtime.manifestSha256,
    jdkTreeSha256: runtime.lock.jdkTreeSha256, adapterSourceSha256: runtime.lock.adapterSourceSha256,
    jars: runtime.lock.jars, classes: runtime.lock.classes, fonts: runtime.lock.fonts, childEnvironmentKeys: Object.keys(environment).sort() };
  const privateStarted = { ...receipt, ...(scoped ? { privateBodyLineBox: { scopeSha256: scoped.sha256, docxSha256: scoped.scope.docxSha256,
    count: scoped.scope.paragraphs.length, typographyVersion: scoped.scope.typographyVersion } } : {}) };
  await writeFile(join(scratch, "started.json"), JSON.stringify(privateStarted, null, 2), { mode: 0o600 });
  try {
    const invoke=(timeout:number)=>exec(join(runtime.manifest.jdkHome,"bin/java"),args,{cwd:scratch,env:environment,timeout,maxBuffer:4*1024*1024});
    const result=child?await child.run(invoke):await invoke(TIMEOUT_MS);
    await writeFile(join(scratch, "stdout.log"), result.stdout, { mode: 0o600 });
    await writeFile(join(scratch, "stderr.log"), result.stderr, { mode: 0o600 });
    if (result.stdout.split("DOCX4J_CONVERSION_BEGIN").length !== 2 || result.stdout.split("DOCX4J_CONVERSION_END").length !== 2 || !result.stdout.includes("DOCX4J_BOUNDARY_DENIED=3") || await digest(input) !== sourceSha256) throw new Error(CONVERSION_ERROR);
    const pdf = await readContractBodyPdfOutput(output);
    const privateBody25 = scoped ? await materialBody25Proof(proofPath, scoped, runtime) : undefined;
    if (scoped && await digest(scopePath) !== scoped.sha256) throw new Error(CONVERSION_ERROR);
    await loadRuntime(expectedRuntimeLockSha256, options.typographyVersion); // The exact frozen descriptor must still match after conversion.
    if (privateBody25) await writeFile(join(scratch, "body25-private-diagnostics.json"), JSON.stringify(privateBody25, null, 2), { mode: 0o600, flag: "wx" });
    const provenance = { ...receipt, boundaryDenials: 3, conversionCalls: 1, pdfSha256: createHash("sha256").update(pdf).digest("hex") };
    await writeFile(join(scratch, "completed.json"), JSON.stringify({ ...provenance, ...(privateBody25 ? { privateBodyLineBox: privateBody25 } : {}) }, null, 2), { mode: 0o600 });
    child?.remaining();
    return { pdf, provenance };
  } catch (cause) {
    const error = cause as { stdout?: string; stderr?: string; message?: string };
    const recordFailure=async()=>{
      await writeFile(join(scratch, "failed.json"), JSON.stringify({ ...privateStarted, status: "failed", message: CONVERSION_ERROR }, null, 2), { mode: 0o600 });
      if (error.stdout) await writeFile(join(scratch, "stdout.log"), error.stdout, { mode: 0o600 });
      if (error.stderr) await writeFile(join(scratch, "stderr.log"), error.stderr, { mode: 0o600 });
    };
    let first:unknown=cause;
    if(official){try{await recordFailure();}catch(receiptError){first=attachPostcheck(first,receiptError);}}
    else await recordFailure();
    throw new Error(CONVERSION_ERROR, { cause:first });
  }
}
