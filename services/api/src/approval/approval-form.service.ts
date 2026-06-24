import { Injectable, Optional } from "@nestjs/common";
import { resolve } from "node:path";
import type { RoleKey } from "@jiangkong/shared-domain";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";

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

    const logs = await this.prisma.approvalActionLog.findMany({
      where: { approvalInstanceId: instance.id },
      orderBy: { createdAt: "asc" }
    });

    const projectId = await this.resolveProjectId(
      this.prisma,
      instance.businessType,
      instance.businessId
    );
    const businessCode = await this.resolveBusinessCode(
      this.prisma,
      instance.businessType,
      instance.businessId
    );

    const actorIds = Array.from(
      new Set([instance.applicantUserId, ...logs.map((log) => log.actorUserId)])
    );
    const users = await this.prisma.user.findMany({ where: { id: { in: actorIds } } });
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    const positionById = new Map<string, string>();
    if (projectId) {
      for (const id of actorIds) {
        const roles = await this.loadActorRoleKeys(this.prisma, id, projectId);
        positionById.set(id, roles.map(roleLabel).join("、"));
      }
    }

    const buffer = await this.renderPdf({
      title: BUSINESS_TYPE_LABELS[instance.businessType] ?? "审批单",
      businessCode,
      applicantName: nameById.get(instance.applicantUserId) ?? instance.applicantUserId,
      nodes: instance.frozenNodes as unknown as FrozenNode[],
      logs: logs.map((log) => ({
        name: nameById.get(log.actorUserId) ?? log.actorUserId,
        position: positionById.get(log.actorUserId) ?? "",
        action: actionLabel(log.action),
        signedAt: formatDateTime(log.createdAt),
        comment: log.comment ?? ""
      }))
    });

    const file = await this.files.uploadPrivateFile({
      buffer,
      originalName: `审批单-${businessCode}.pdf`,
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
      metadata: { pdfDocumentId: pdfDocument.id, fileId: file.id, businessCode }
    });

    return pdfDocument;
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

  private async renderPdf(input: {
    title: string;
    businessCode: string;
    applicantName: string;
    nodes: FrozenNode[];
    logs: Array<{
      name: string;
      position: string;
      action: string;
      signedAt: string;
      comment: string;
    }>;
  }): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolvePromise) => {
      doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    });

    doc.registerFont("cn", FONT_PATH);
    doc.font("cn");

    doc.fontSize(20).text(input.title, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`单号：${input.businessCode}`, { align: "center" });
    doc.text(`申请人：${input.applicantName}`, { align: "center" });
    doc.text(`生成时间：${formatDateTime(new Date())}`, { align: "center" });
    doc.moveDown(1);

    doc.fontSize(13).text("审批路线");
    doc.moveDown(0.3);
    doc.fontSize(10);
    input.nodes.forEach((node, index) => {
      const mode = node.mode === "all" ? "会签" : "或签";
      const roles = (node.roleKeys ?? []).map(roleLabel).join("、");
      doc.text(`${index + 1}. ${node.name}（${mode}）  审批角色：${roles}`);
    });
    doc.moveDown(1);

    doc.fontSize(13).text("签批记录");
    doc.moveDown(0.3);
    doc.fontSize(10);
    input.logs.forEach((log, index) => {
      const position = log.position ? `（${log.position}）` : "";
      doc.text(`${index + 1}. ${log.name}${position}  ${log.action}  ${log.signedAt}`);
      if (log.comment) {
        doc.text(`    备注：${log.comment}`);
      }
    });
    if (input.logs.length === 0) {
      doc.text("（无签批记录）");
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
