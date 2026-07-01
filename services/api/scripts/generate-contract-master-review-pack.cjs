const { createHash } = require("node:crypto");
const { copyFile, mkdir, readFile, readdir, writeFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { PrismaClient } = require("@prisma/client");

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const apiRoot = path.resolve(__dirname, "..");
const storageRoot = path.resolve(
  process.env.FILE_STORAGE_ROOT ?? path.join(apiRoot, "storage", "private")
);
const outputRoot = path.resolve(
  process.env.CONTRACT_MASTER_REVIEW_DIR ??
    path.join(apiRoot, "storage", "review-packs", `contract-master-1.0-${stamp()}`)
);
const pdfInfoCommand = process.env.PDFINFO_COMMAND || "pdfinfo";
const pdfToPpmCommand = process.env.PDFTOPPM_COMMAND || "pdftoppm";

const targets = [
  { code: "material_purchase", label: "材料采购合同", prefix: "01-material-purchase" },
  { code: "equipment_rental", label: "工程机械设备租赁合同", prefix: "02-equipment-rental" },
  { code: "labor_subcontract", label: "劳务分包合同", prefix: "03-labor-subcontract" },
  { code: "generic_contract", label: "通用合同", prefix: "04-generic-contract" }
];

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertCommand(command, args) {
  try {
    await execFileAsync(command, args);
  } catch {
    throw new Error(`${command} is unavailable; set PDFINFO_COMMAND/PDFTOPPM_COMMAND or install poppler.`);
  }
}

function resolveStorageObject(objectKey) {
  const target = path.resolve(storageRoot, objectKey);
  const rootPrefix = storageRoot.endsWith(path.sep) ? storageRoot : `${storageRoot}${path.sep}`;
  assert(target === storageRoot || target.startsWith(rootPrefix), `Invalid storage object key: ${objectKey}`);
  return target;
}

async function latestSuccessfulDraftByType(contractTypeKey) {
  const documents = await prisma.contractGeneratedDocument.findMany({
    where: {
      purpose: "draft",
      status: "success",
      docxFileId: { not: null },
      pdfFileId: { not: null }
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 500
  });

  for (const document of documents) {
    const version = await prisma.contractVersion.findUnique({
      where: { id: document.contractVersionId }
    });
    if (!version) continue;
    const contract = await prisma.contract.findUnique({ where: { id: version.contractId } });
    if (contract?.contractTypeKey !== contractTypeKey) continue;
    const [docxFile, pdfFile] = await Promise.all([
      prisma.fileObject.findUnique({ where: { id: document.docxFileId } }),
      prisma.fileObject.findUnique({ where: { id: document.pdfFileId } })
    ]);
    if (docxFile && pdfFile) return { document, version, contract, docxFile, pdfFile };
  }

  throw new Error(`No successful draft document found for ${contractTypeKey}; run verify:contract-workbench first.`);
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function pdfPageCount(pdfPath) {
  const { stdout } = await execFileAsync(pdfInfoCommand, [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)$/m);
  assert(match, `Cannot read page count from ${pdfPath}`);
  return Number(match[1]);
}

async function renderPdfPages(pdfPath, pageDir, prefix) {
  await mkdir(pageDir, { recursive: true });
  const outputPrefix = path.join(pageDir, prefix);
  await execFileAsync(pdfToPpmCommand, ["-png", "-r", "120", pdfPath, outputPrefix], {
    maxBuffer: 1024 * 1024 * 20
  });
}

function pagePreviewPath(item, pageNumber) {
  const padded = String(pageNumber).padStart(String(item.pages).length, "0");
  return `pages/${item.prefix}/${item.prefix}-${padded}.png`;
}

function checklist(items) {
  const lines = [
    "# 公司级正式合同母版 1.0 逐页验收清单",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "验收口径：以 Word 打开效果为最终准绳，PDF/PNG 仅用于快速逐页审阅。正式法律文本仍需完成主体授权、审批、签章、归档。",
    "",
    "## 母版总体签认",
    "",
    "| 验收项 | 结论 | 问题记录 | 验收人 | 日期 |",
    "| --- | --- | --- | --- | --- |",
    "| 封面、首页、正文、表格、签章页整体达到公司正式合同母版 1.0 标准 |  |  |  |  |",
    "| 字体、字号、行距、段前段后、页边距、分页统一 |  |  |  |  |",
    "| 合同条款内容、关键字段、清单字段满足合同部/法务要求 |  |  |  |  |",
    "| 草稿水印、页眉、页脚、附件页规则符合当前阶段要求 |  |  |  |  |",
    "",
    "## 合同文件",
    "",
    "| 合同类型 | DOCX | PDF | 页数 | 源合同编号 |",
    "| --- | --- | --- | ---: | --- |",
    ...items.map(
      (item) =>
        `| ${item.label} | [DOCX](documents/${item.prefix}.docx) | [PDF](documents/${item.prefix}.pdf) | ${item.pages} | ${item.temporaryCode} |`
    ),
    "",
    "## 逐页验收",
    "",
    "| 合同类型 | 页码 | 页面预览 | 版式 | 文字/字段 | 表格/签章/附件 | 问题记录 | 验收人 |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- |"
  ];

  for (const item of items) {
    for (let page = 1; page <= item.pages; page += 1) {
      lines.push(
        `| ${item.label} | ${page}/${item.pages} | [PNG](${pagePreviewPath(item, page)}) |  |  |  |  |  |`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function buildPack() {
  await assertCommand(pdfInfoCommand, ["-v"]);
  await assertCommand(pdfToPpmCommand, ["-v"]);
  const documentsDir = path.join(outputRoot, "documents");
  const pagesRoot = path.join(outputRoot, "pages");
  await mkdir(documentsDir, { recursive: true });

  const items = [];
  for (const target of targets) {
    const found = await latestSuccessfulDraftByType(target.code);
    const docxPath = path.join(documentsDir, `${target.prefix}.docx`);
    const pdfPath = path.join(documentsDir, `${target.prefix}.pdf`);
    await copyFile(resolveStorageObject(found.docxFile.objectKey), docxPath);
    await copyFile(resolveStorageObject(found.pdfFile.objectKey), pdfPath);
    const pages = await pdfPageCount(pdfPath);
    const pageDir = path.join(pagesRoot, target.prefix);
    await renderPdfPages(pdfPath, pageDir, target.prefix);
    const renderedPages = (await readdir(pageDir)).filter((name) => name.endsWith(".png"));
    assert(
      renderedPages.length === pages,
      `${target.code} rendered ${renderedPages.length} page previews, expected ${pages}`
    );
    items.push({
      ...target,
      pages,
      temporaryCode: found.contract.temporaryCode,
      contractId: found.contract.id,
      contractVersionId: found.version.id,
      generatedDocumentId: found.document.id,
      docxFileId: found.docxFile.id,
      pdfFileId: found.pdfFile.id,
      docxSha256: await sha256(docxPath),
      pdfSha256: await sha256(pdfPath)
    });
    console.log(`ok ${target.code} ${pages} pages`);
  }

  await writeFile(path.join(outputRoot, "CHECKLIST.md"), checklist(items));
  await writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`
  );
  console.log(`ok review pack ${outputRoot}`);
}

buildPack()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
