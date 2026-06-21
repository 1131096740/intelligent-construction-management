import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ContractDetailReadModel,
  CoreFlowTone
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ContractReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getDetail(contractId: string): Promise<ContractDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(contractId);
    }

    const contract = await this.prisma.contract.findFirst({
      where: { OR: [{ id: contractId }, { code: contractId }] }
    });

    if (!contract) {
      throw new NotFoundException("Contract not found");
    }

    const [project, version] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: contract.projectId } }),
      this.prisma.contractVersion.findFirst({
        where: { contractId: contract.id },
        orderBy: { versionNo: "desc" }
      })
    ]);

    if (!version) {
      throw new NotFoundException("Contract version not found");
    }

    const terms = await this.prisma.paymentTermsVersion.findFirst({
      where: { contractVersionId: version.id },
      orderBy: { versionNo: "desc" }
    });

    if (!terms) {
      throw new NotFoundException("Payment terms version not found");
    }

    const [stages, settlement] = await Promise.all([
      this.prisma.paymentTermsStage.findMany({
        where: { paymentTermsVersionId: terms.id },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.settlement.findFirst({
        where: { contractVersionId: version.id },
        orderBy: { createdAt: "desc" }
      })
    ]);

    const status = this.statusView(version.status);

    return {
      id: contract.code,
      title: `${contract.code} · ${contract.name}`,
      meta: [
        { label: "当前状态", value: status.label, tone: status.tone },
        { label: "当前版本", value: `合同 v${version.versionNo}` },
        { label: "付款条款", value: `v${terms.versionNo} ${this.termsStatusLabel(terms.status)}` },
        { label: "责任部门", value: "合同部" },
        { label: "当前处理人", value: this.currentOwnerLabel(version.status) },
        { label: "下一步动作", value: this.nextActionLabel(version.status), tone: status.tone }
      ],
      baseInfo: [
        { label: "合同编号", value: contract.code },
        { label: "合同名称", value: contract.name },
        { label: "项目", value: project?.name ?? contract.projectId },
        { label: "相对方", value: contract.counterparty },
        { label: "合同金额", value: this.formatMoney(version.amountCents) },
        { label: "创建人", value: "合同部" }
      ],
      effectivenessSteps: this.effectivenessSteps(version.status),
      paymentTermStages: stages.map((stage) => ({
        id: stage.id,
        version: `v${terms.versionNo}`,
        paymentTermsVersion: `v${terms.versionNo}`,
        status: this.termsStatusLabel(terms.status),
        contractVersion: `合同 v${version.versionNo}`,
        basis: this.basisLabel(stage.basis),
        ratio: this.ratioLabel(stage.ratioBps),
        accountPeriod: `${stage.dueDays}天`,
        triggerEvent: stage.triggerEvent
      })),
      settlementBlockMessage: this.settlementBlockMessage(version.status),
      chainLinks: [
        { label: "关联合同台账", to: "/contracts" },
        { label: "关联结算", to: settlement ? `/settlements/${settlement.code}` : "/settlements" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private sampleDetail(contractId: string): ContractDetailReadModel {
    return {
      id: contractId,
      title: "HT-2026-001 · 钢材采购合同",
      meta: [
        { label: "当前状态", value: "待用章", tone: "warning" },
        { label: "当前版本", value: "合同 v1" },
        { label: "付款条款", value: "v1 草拟中" },
        { label: "责任部门", value: "合同部" },
        { label: "当前处理人", value: "合同部成员" },
        { label: "下一步动作", value: "发起用章", tone: "warning" }
      ],
      baseInfo: [
        { label: "合同编号", value: contractId },
        { label: "合同名称", value: "钢材采购合同" },
        { label: "项目", value: "建设项目一期" },
        { label: "相对方", value: "钢材供应商" },
        { label: "合同金额", value: "¥1,280,000.00" },
        { label: "创建人", value: "合同部 李工" }
      ],
      effectivenessSteps: [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "待处理", tone: "warning" },
        { label: "归档上传", status: "未开始", tone: "default" },
        { label: "主管确认", status: "未开始", tone: "default" },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ],
      paymentTermStages: [
        {
          id: "current-settlement-payment",
          version: "v1",
          paymentTermsVersion: "v1",
          status: "随合同生效",
          contractVersion: "合同 v1",
          basis: "当期结算",
          ratio: "80%",
          accountPeriod: "30天",
          triggerEvent: "结算归档生效"
        },
        {
          id: "retention-payment",
          version: "v1",
          paymentTermsVersion: "v1",
          status: "随合同生效",
          contractVersion: "合同 v1",
          basis: "质保金",
          ratio: "20%",
          accountPeriod: "365天",
          triggerEvent: "质保期满"
        }
      ],
      settlementBlockMessage:
        "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。",
      chainLinks: [
        { label: "关联合同台账", to: "/contracts" },
        { label: "关联结算", to: "/settlements/JS-2026-018" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private statusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      draft: { label: "草拟中", tone: "default" },
      approval_pending: { label: "审批中", tone: "primary" },
      approved: { label: "待用章", tone: "warning" },
      sealed_pending_archive: { label: "待归档确认", tone: "primary" },
      effective: { label: "已生效", tone: "success" },
      voided: { label: "已作废", tone: "danger" }
    };

    return views[status] ?? { label: status, tone: "default" };
  }

  private termsStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草拟中",
      effective: "已生效",
      archived: "已归档"
    };

    return labels[status] ?? status;
  }

  private currentOwnerLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "合同部成员",
      approval_pending: "审批节点处理人",
      approved: "合同部成员",
      sealed_pending_archive: "合同部主管",
      effective: "系统归档",
      voided: "系统归档"
    };

    return labels[status] ?? "合同部";
  }

  private nextActionLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "提交合同审批",
      approval_pending: "等待审批",
      approved: "发起用章",
      sealed_pending_archive: "主管确认归档",
      effective: "可发起结算",
      voided: "无"
    };

    return labels[status] ?? "待处理";
  }

  private effectivenessSteps(status: string): ContractDetailReadModel["effectivenessSteps"] {
    if (status === "effective") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "已完成", tone: "success" },
        { label: "归档上传", status: "已上传", tone: "success" },
        { label: "主管确认", status: "已确认", tone: "success" },
        { label: "合同生效", status: "已生效", tone: "success" }
      ];
    }

    if (status === "approved") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "待处理", tone: "warning" },
        { label: "归档上传", status: "未开始", tone: "default" },
        { label: "主管确认", status: "未开始", tone: "default" },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ];
    }

    return [
      { label: "合同审批", status: status === "approval_pending" ? "处理中" : "未提交", tone: "primary" },
      { label: "用章", status: "未开始", tone: "default" },
      { label: "归档上传", status: "未开始", tone: "default" },
      { label: "主管确认", status: "未开始", tone: "default" },
      { label: "合同生效", status: "阻塞", tone: "danger" }
    ];
  }

  private settlementBlockMessage(status: string): string {
    if (status === "effective") {
      return "合同版本已生效，可基于当前合同版本创建结算；付款条款版本将随结算一并绑定。";
    }

    return "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。";
  }

  private basisLabel(basis: string): string {
    const labels: Record<string, string> = {
      contract_amount: "合同金额",
      current_settlement: "当期结算",
      cumulative_settlement: "累计结算",
      fixed_amount: "固定金额",
      manual_amount: "人工确认金额"
    };

    return labels[basis] ?? basis;
  }

  private ratioLabel(ratioBps: number | null): string {
    if (ratioBps === null) {
      return "-";
    }

    return `${ratioBps / 100}%`;
  }

  private formatMoney(amountCents: number): string {
    return `¥${(amountCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
}
