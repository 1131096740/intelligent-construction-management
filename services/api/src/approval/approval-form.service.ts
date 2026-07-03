import { Injectable, Optional } from "@nestjs/common";
import { resolve } from "node:path";
import type { RoleKey } from "@jiangkong/shared-domain";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { centsToSafeNumber } from "../money/decimal-money";

const APPROVAL_FORM_TEMPLATE_KEY = "approval_form";
const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

// 审批路线节点（与各业务 service 的 frozenNodes 形态一致：name/mode/roleKeys）
interface FrozenNode {
  name: string;
  mode: string;
  roleKeys: RoleKey[];
}

const ROLE_LABELS: Record<string, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "施工队长",
  engineering_tech: "技术员",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

const ACTION_LABELS: Record<string, string> = {
  submit: "提交",
  approve: "通过",
  reject: "驳回",
  reject_previous: "退回上一节点",
  return_to_applicant: "退回申请人",
  withdraw: "撤回",
  transfer: "转交",
  delegate: "委托",
  remind: "催办"
};

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  contract_version: "合同审批单",
  settlement: "结算审批单",
  payment_request: "付款审批单"
};

const roleLabel = (key: string) => ROLE_LABELS[key] ?? key;
const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

function formatDateTime(value: Date): string {
  // 本地化为 YYYY-MM-DD HH:mm:ss，避免依赖运行环境 locale
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function formatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// 分 -> 「1,234.56 元」，不依赖运行环境 locale。
function formatYuan(cents: number | bigint): string {
  const safe = centsToSafeNumber(typeof cents === "bigint" ? cents : BigInt(cents));
  const [intPart, decPart] = (safe / 100).toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${decPart} 元`;
}

interface TableColumn {
  header: string;
  width: number;
}

interface RenderInput {
  title: string;
  companyName: string;
  businessCode: string;
  applicantName: string;
  summary: Array<{ label: string; value: string }>;
  nodes: FrozenNode[];
  logs: Array<{
    name: string;
    position: string;
    action: string;
    signedAt: string;
    comment: string;
    signature: Buffer | null;
  }>;
  watermark?: string[];
}

// 画带框线的表格，返回表格底部 y。单元格内文本自动换行；行高随内容增长。
// 可选 imageColumn + rowImages（按数据行索引）在指定列嵌入图片（如签名图）。
function drawTable(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  options: {
    headerRow?: boolean;
    minRowHeight?: number;
    imageColumn?: number;
    rowImages?: (Buffer | null)[];
  } = {}
): number {
  const cellPadding = 4;
  const fontSize = 9;
  doc.fontSize(fontSize);
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  const hasHeader = options.headerRow !== false;
  const all = hasHeader ? [columns.map((c) => c.header), ...rows] : rows;
  let y = startY;

  all.forEach((row, rowIndex) => {
    const isHeader = hasHeader && rowIndex === 0;
    const dataIndex = hasHeader ? rowIndex - 1 : rowIndex;
    const rowHeight = Math.max(
      Math.max(
        ...row.map((cell, colIndex) =>
          doc.heightOfString(cell || "", { width: columns[colIndex].width - cellPadding * 2 })
        )
      ) +
        cellPadding * 2,
      isHeader ? 0 : options.minRowHeight ?? 0
    );

    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    let x = startX;
    row.forEach((cell, colIndex) => {
      const width = columns[colIndex].width;
      if (isHeader) {
        doc.rect(x, y, width, rowHeight).fill("#eeeeee");
        doc.fillColor("#000000");
      }
      doc.rect(x, y, width, rowHeight).stroke("#000000");

      const image = !isHeader && colIndex === options.imageColumn ? options.rowImages?.[dataIndex] : null;
      if (image) {
        try {
          doc.image(image, x + cellPadding, y + cellPadding, {
            fit: [width - cellPadding * 2, rowHeight - cellPadding * 2],
            align: "center",
            valign: "center"
          });
        } catch {
          // 签名图损坏/格式不支持时退化为空白单元格，不影响整单渲染。
        }
      } else {
        doc.text(cell || "", x + cellPadding, y + cellPadding, {
          width: width - cellPadding * 2
        });
      }
      x += width;
    });
    y += rowHeight;
  });

  return y;
}

// 仅接受 PNG/JPEG 魔数的图片用于嵌入，廉价挡掉非图片字节。
// ponytail: 头部合法但 IDAT 损坏的 PNG 仍可能拖慢 pdfkit 解码；上传走图片选择器，正常不触发。
function isEmbeddableImage(buffer: Buffer | null): boolean {
  if (!buffer || buffer.length < 4) return false;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return isPng || isJpeg;
}

// 平铺对角水印（浅灰半透明），盖在内容之上。用于下载件按下载人留痕。
function stampWatermark(doc: PDFKit.PDFDocument, lines: string[]): void {
  const text = lines.filter(Boolean).join("  ·  ");
  if (!text) return;
  doc.save();
  doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font("cn").fontSize(11).fillColor("#000000").fillOpacity(0.08);
  for (let x = -120; x < doc.page.width + 240; x += 250) {
    for (let y = 0; y < doc.page.height + 240; y += 92) {
      doc.text(text, x, y, { lineBreak: false });
    }
  }
  doc.restore();
  doc.fillOpacity(1).fillColor("#000000");
}

@Injectable()
export class ApprovalFormService {
  constructor(
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly audit: AuditService = new AuditService()
  ) {}

  // 审批通过后由各业务流程事务外调用，best-effort 生成审批单 PDF 并归档。幂等。
  async generateForInstance(instanceId: string, actorUserId: string) {
    if (!this.prisma || !this.files) {
      throw new Error("Prisma and file services are required to generate approval form");
    }

    const instance = await this.prisma.approvalInstance.findUnique({
      where: { id: instanceId }
    });

    if (!instance || instance.status !== "approved") {
      return null;
    }

    const existing = await this.prisma.pdfDocument.findFirst({
      where: {
        businessType: instance.businessType,
        businessId: instance.businessId,
        templateKey: APPROVAL_FORM_TEMPLATE_KEY
      }
    });
    if (existing) {
      return existing;
    }

    const input = await this.buildRenderInput(instance);
    const buffer = await this.renderPdf(input);

    const file = await this.files.uploadPrivateFile({
      buffer,
      originalName: `审批单-${input.businessCode}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId
    });

    const pdfDocument = await this.prisma.pdfDocument.create({
      data: {
        businessType: instance.businessType,
        businessId: instance.businessId,
        fileId: file.id,
        templateKey: APPROVAL_FORM_TEMPLATE_KEY
      }
    });

    await this.audit.record(this.prisma, {
      actorUserId,
      action: "approval.form.generate",
      businessType: instance.businessType,
      businessId: instance.businessId,
      metadata: { pdfDocumentId: pdfDocument.id, fileId: file.id, businessCode: input.businessCode }
    });

    return pdfDocument;
  }

  // 下载时按下载人动态生成带水印审批单（谁下的+时间+公司名，可追溯防泄露）。
  async renderForDownload(businessType: string, businessId: string, downloaderUserId: string) {
    if (!this.prisma || !this.files) {
      throw new Error("Prisma and file services are required to download approval form");
    }

    // 复用归档 PdfDocument 做权限锚点与幂等；其字节为无水印存档件，下载件按下载人重渲染。
    const pdfDocument = await this.getOrCreateByBusiness(businessType, businessId, downloaderUserId);
    if (!pdfDocument) {
      throw new Error("Approval form is not available yet");
    }
    await this.files.assertCanDownloadFileById(pdfDocument.fileId, downloaderUserId);

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { businessType, businessId, status: "approved" },
      orderBy: { updatedAt: "desc" }
    });
    if (!instance) {
      throw new Error("No completed approval found for this business object");
    }

    const downloader = await this.prisma.user.findUnique({ where: { id: downloaderUserId } });
    const input = await this.buildRenderInput(instance);
    const watermark = [
      input.companyName || "建工智管",
      `下载人：${downloader?.name ?? downloaderUserId}`,
      formatDateTime(new Date())
    ];
    const buffer = await this.renderPdf({ ...input, watermark });

    await this.audit.record(this.prisma, {
      actorUserId: downloaderUserId,
      action: "approval.form.download",
      businessType,
      businessId,
      metadata: { fileId: pdfDocument.fileId, businessCode: input.businessCode }
    });

    return { buffer, fileName: `审批单-${input.businessCode}.pdf` };
  }

  // 收集渲染审批单所需的全部数据（业务摘要、我方主体、签批人姓名/职位/签名图）。
  private async buildRenderInput(instance: {
    id: string;
    businessType: string;
    businessId: string;
    applicantUserId: string;
    frozenNodes: unknown;
  }): Promise<RenderInput> {
    const prisma = this.prisma!;
    const logs = await prisma.approvalActionLog.findMany({
      where: { approvalInstanceId: instance.id },
      orderBy: { createdAt: "asc" }
    });

    const [projectId, businessCode, summary, companyName] = await Promise.all([
      this.resolveProjectId(prisma, instance.businessType, instance.businessId),
      this.resolveBusinessCode(prisma, instance.businessType, instance.businessId),
      this.resolveBusinessSummary(prisma, instance.businessType, instance.businessId),
      this.resolveCompanyName(prisma, instance.businessType, instance.businessId)
    ]);

    const actorIds = Array.from(
      new Set([instance.applicantUserId, ...logs.map((log) => log.actorUserId)])
    );
    const users = await prisma.user.findMany({ where: { id: { in: actorIds } } });
    const nameById = new Map(users.map((user) => [user.id, user.name]));
    const signatureFileIdById = new Map(users.map((user) => [user.id, user.signatureFileId]));

    const positionById = new Map<string, string>();
    if (projectId) {
      for (const id of actorIds) {
        const roles = await this.loadActorRoleKeys(prisma, id, projectId);
        positionById.set(id, roles.map(roleLabel).join("、"));
      }
    }

    // 懒加载签名图字节（仅签批人各取一次）。
    const signatureBufferById = new Map<string, Buffer | null>();
    for (const log of logs) {
      if (signatureBufferById.has(log.actorUserId)) continue;
      const fileId = signatureFileIdById.get(log.actorUserId);
      const buffer = fileId
        ? await this.files!
            .getFileBuffer(fileId)
            .then((result) => result.buffer)
            .catch(() => null)
        : null;
      signatureBufferById.set(log.actorUserId, isEmbeddableImage(buffer) ? buffer : null);
    }

    return {
      title: BUSINESS_TYPE_LABELS[instance.businessType] ?? "审批单",
      companyName,
      businessCode,
      applicantName: nameById.get(instance.applicantUserId) ?? instance.applicantUserId,
      summary,
      nodes: instance.frozenNodes as unknown as FrozenNode[],
      logs: logs.map((log) => ({
        name: nameById.get(log.actorUserId) ?? log.actorUserId,
        position: positionById.get(log.actorUserId) ?? "",
        action: actionLabel(log.action),
        signedAt: formatDateTime(log.createdAt),
        comment: log.comment ?? "",
        signature: signatureBufferById.get(log.actorUserId) ?? null
      }))
    };
  }

  // 控制器惰性获取：若已通过的审批已有审批单则返回，否则补生成。
  async getOrCreateByBusiness(businessType: string, businessId: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to load approval form");
    }

    const existing = await this.prisma.pdfDocument.findFirst({
      where: { businessType, businessId, templateKey: APPROVAL_FORM_TEMPLATE_KEY }
    });
    if (existing) {
      return existing;
    }

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { businessType, businessId, status: "approved" },
      orderBy: { updatedAt: "desc" }
    });
    if (!instance) {
      throw new Error("No completed approval found for this business object");
    }

    return this.generateForInstance(instance.id, actorUserId);
  }

  private async renderPdf(input: RenderInput): Promise<Buffer> {
    const margin = 48;
    const doc = new PDFDocument({ size: "A4", margin, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolvePromise) => {
      doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    });

    doc.registerFont("cn", FONT_PATH);
    doc.font("cn");

    const left = margin;
    const contentWidth = doc.page.width - margin * 2;

    // 抬头：我方公司主体名（合同签订时快照）。
    if (input.companyName) {
      doc.fontSize(12).text(input.companyName, left, doc.y, {
        width: contentWidth,
        align: "center"
      });
      doc.moveDown(0.3);
    }
    doc.fontSize(20).text(input.title, left, doc.y, { width: contentWidth, align: "center" });
    let y = doc.y + 14;

    // 业务信息栏（label | value 两列），含单号/申请人/生成时间 + 业务摘要
    const infoRows: string[][] = [
      ["单号", input.businessCode],
      ["申请人", input.applicantName],
      ...input.summary.map((item): string[] => [item.label, item.value]),
      ["生成时间", formatDateTime(new Date())]
    ];
    y =
      drawTable(
        doc,
        left,
        y,
        [
          { header: "项目", width: 100 },
          { header: "内容", width: contentWidth - 100 }
        ],
        infoRows,
        { headerRow: false }
      ) + 16;

    // 审批路线
    doc.fontSize(12).text("审批路线", left, y);
    y = doc.y + 4;
    y =
      drawTable(
        doc,
        left,
        y,
        [
          { header: "序号", width: 36 },
          { header: "审批节点", width: 150 },
          { header: "签批方式", width: 70 },
          { header: "审批角色", width: contentWidth - 36 - 150 - 70 }
        ],
        input.nodes.map((node, index) => [
          String(index + 1),
          node.name,
          node.mode === "all" ? "会签" : "或签",
          (node.roleKeys ?? []).map(roleLabel).join("、")
        ])
      ) + 16;

    // 签批记录（含签名图列）
    doc.fontSize(12).text("签批记录", left, y);
    y = doc.y + 4;
    const hasLogs = input.logs.length > 0;
    const sigCols = [
      { header: "序号", width: 30 },
      { header: "审批人", width: 64 },
      { header: "职位", width: 76 },
      { header: "动作", width: 44 },
      { header: "签批时间", width: 92 },
      { header: "审批意见", width: contentWidth - 30 - 64 - 76 - 44 - 92 - 100 },
      { header: "签名", width: 100 }
    ];
    const sigRows = hasLogs
      ? input.logs.map((log, index) => [
          String(index + 1),
          log.name,
          log.position,
          log.action,
          log.signedAt,
          log.comment,
          ""
        ])
      : [["", "（无签批记录）", "", "", "", "", ""]];
    drawTable(doc, left, y, sigCols, sigRows, {
      minRowHeight: 44,
      imageColumn: 6,
      rowImages: hasLogs ? input.logs.map((log) => log.signature) : [null]
    });

    // 下载水印：按下载人动态平铺，可追溯防泄露。
    if (input.watermark?.length) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        stampWatermark(doc, input.watermark);
      }
      doc.flushPages();
    }

    doc.end();
    return done;
  }

  private async resolveProjectId(
    prisma: PrismaService,
    businessType: string,
    businessId: string
  ): Promise<string | null> {
    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      return settlement?.projectId ?? null;
    }
    if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      return payment?.projectId ?? null;
    }
    if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      const contract = version
        ? await prisma.contract.findUnique({ where: { id: version.contractId } })
        : null;
      return contract?.projectId ?? null;
    }
    return null;
  }

  private async resolveBusinessCode(
    prisma: PrismaService,
    businessType: string,
    businessId: string
  ): Promise<string> {
    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      return settlement?.code ?? businessId;
    }
    if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      return payment?.code ?? businessId;
    }
    if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      const contract = version
        ? await prisma.contract.findUnique({ where: { id: version.contractId } })
        : null;
      return contract?.code ?? businessId;
    }
    return businessId;
  }

  // 我方公司主体名（审批单抬头）：三类业务均回溯到合同上的 companyEntityName 快照。
  private async resolveCompanyName(
    prisma: PrismaService,
    businessType: string,
    businessId: string
  ): Promise<string> {
    let contractId: string | null = null;
    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      contractId = settlement?.contractId ?? null;
    } else if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      contractId = payment?.contractId ?? null;
    } else if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      contractId = version?.contractId ?? null;
    }
    if (!contractId) {
      return "";
    }
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    return contract?.companyEntityName ?? "";
  }

  // 业务信息栏：按业务类型取关键字段（金额/对方/事由等）。查不到的字段直接略过。
  private async resolveBusinessSummary(
    prisma: PrismaService,
    businessType: string,
    businessId: string
  ): Promise<Array<{ label: string; value: string }>> {
    if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      if (!payment) return [];
      const [settlement, contract] = await Promise.all([
        payment.settlementId
          ? prisma.settlement.findUnique({ where: { id: payment.settlementId } })
          : Promise.resolve(null),
        prisma.contract.findUnique({ where: { id: payment.contractId } })
      ]);
      const rows: Array<{ label: string; value: string }> = [
        { label: "申请金额", value: formatYuan(payment.requestedAmountCents) }
      ];
      if (payment.approvedAmountCents != null) {
        rows.push({ label: "批准金额", value: formatYuan(payment.approvedAmountCents) });
      }
      if (payment.sourceType === "contract_advance") {
        rows.push({ label: "付款类型", value: "合同预付款" });
      }
      if (contract) rows.push({ label: "收款方", value: contract.counterparty });
      if (settlement) rows.push({ label: "对应结算", value: settlement.code });
      if (payment.dueDate) rows.push({ label: "付款期限", value: formatDate(payment.dueDate) });
      return rows;
    }

    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      if (!settlement) return [];
      const contract = await prisma.contract.findUnique({
        where: { id: settlement.contractId }
      });
      const rows: Array<{ label: string; value: string }> = [
        { label: "结算期次", value: settlement.periodLabel },
        { label: "结算金额", value: formatYuan(settlement.amountCents) },
        { label: "应付金额", value: formatYuan(settlement.payableAmountCents) }
      ];
      if (contract) {
        rows.push({ label: "对应合同", value: `${contract.name}（${contract.code}）` });
        rows.push({ label: "对方单位", value: contract.counterparty });
      }
      return rows;
    }

    if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      if (!version) return [];
      const contract = await prisma.contract.findUnique({ where: { id: version.contractId } });
      const rows: Array<{ label: string; value: string }> = [];
      if (contract) {
        rows.push({ label: "合同名称", value: contract.name });
        rows.push({ label: "对方单位", value: contract.counterparty });
      }
      rows.push({ label: "合同金额", value: formatYuan(version.amountCents) });
      rows.push({ label: "版本号", value: `第 ${version.versionNo} 版` });
      return rows;
    }

    return [];
  }

  // 与各业务 service 的岗位解析一致：全局/项目岗位 + 项目成员岗位。
  private async loadActorRoleKeys(
    prisma: PrismaService,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      prisma.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      prisma.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      prisma.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set(
        [...globalPositions, ...projectPositions].map((position) => position.positionId)
      )
    );
    const positions = positionIds.length
      ? await prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
  }
}

export { APPROVAL_FORM_TEMPLATE_KEY };
