import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CoreFlowTone,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class SettlementReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getDetail(settlementId: string): Promise<SettlementDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(settlementId);
    }

    const settlement = await this.prisma.settlement.findFirst({
      where: { OR: [{ id: settlementId }, { code: settlementId }] }
    });

    if (!settlement) {
      throw new NotFoundException("Settlement not found");
    }

    const [contract, contractVersion, terms, paymentRequest] = await Promise.all([
      this.prisma.contract.findUnique({ where: { id: settlement.contractId } }),
      this.prisma.contractVersion.findUnique({ where: { id: settlement.contractVersionId } }),
      this.prisma.paymentTermsVersion.findUnique({
        where: { id: settlement.paymentTermsVersionId }
      }),
      this.prisma.paymentRequest.findFirst({
        where: { settlementId: settlement.id },
        orderBy: { createdAt: "desc" }
      })
    ]);

    if (!contract) {
      throw new NotFoundException("Settlement contract not found");
    }

    if (!contractVersion) {
      throw new NotFoundException("Settlement contract version not found");
    }

    if (!terms) {
      throw new NotFoundException("Settlement payment terms version not found");
    }

    const stages = await this.prisma.paymentTermsStage.findMany({
      where: { paymentTermsVersionId: terms.id },
      orderBy: { createdAt: "asc" }
    });
    const status = this.statusView(settlement.status);

    return {
      id: settlement.code,
      settlementId: settlement.id,
      title: `${settlement.code} · ${settlement.periodLabel}结算单`,
      meta: [
        { label: "当前状态", value: status.label, tone: status.tone },
        { label: "关联合同版本", value: `合同 v${contractVersion.versionNo}` },
        { label: "付款条款版本", value: `v${terms.versionNo} 随合同生效` },
        { label: "结算期间", value: settlement.periodLabel },
        { label: "责任部门", value: "合同部" },
        { label: "下一步动作", value: this.nextActionLabel(settlement.status), tone: status.tone }
      ],
      baseInfo: [
        { label: "结算编号", value: settlement.code },
        { label: "关联合同", value: `${contract.code} · ${contract.name}` },
        { label: "结算性质", value: "月度结算" },
        { label: "是否最终结算", value: "否" },
        { label: "结算金额", value: this.formatMoney(settlement.amountCents) },
        { label: "创建人", value: "项目经理" }
      ],
      effectivenessSteps: this.effectivenessSteps(settlement.status),
      archiveResponsibilities: [
        "结算审批不经过董事长/总经理",
        "结算归档件由合同部成员上传",
        "归档由合同部主管确认",
        "财务只读取业务归档件"
      ],
      paymentRules: stages.map((stage) => ({
        id: stage.id,
        stage: stage.name,
        ratio: this.ratioLabel(stage.ratioBps),
        accountPeriod: `${stage.dueDays}天`,
        triggerCondition: stage.triggerEvent,
        paymentRequestStatus: paymentRequest?.status ?? this.defaultPaymentRequestStatus(settlement.status)
      })),
      paymentBlockMessage: this.paymentBlockMessage(settlement.status),
      chainLinks: [
        { label: "关联合同", to: `/contracts/${contract.code}` },
        { label: "付款申请", to: paymentRequest ? `/payments/${paymentRequest.code}` : "/payments" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private sampleDetail(settlementId: string): SettlementDetailReadModel {
    return {
      id: settlementId,
      settlementId: "settlement-sample",
      title: "JS-2026-018 · 5月材料结算单",
      meta: [
        { label: "当前状态", value: "待归档确认", tone: "primary" },
        { label: "关联合同版本", value: "合同 v1" },
        { label: "付款条款版本", value: "v1 随合同生效" },
        { label: "结算期间", value: "2026-05" },
        { label: "责任部门", value: "合同部" },
        { label: "下一步动作", value: "主管确认归档", tone: "primary" }
      ],
      baseInfo: [
        { label: "结算编号", value: settlementId },
        { label: "关联合同", value: "HT-2026-001 · 钢材采购合同" },
        { label: "结算性质", value: "月度结算" },
        { label: "是否最终结算", value: "否" },
        { label: "结算金额", value: "¥320,000.00" },
        { label: "创建人", value: "项目经理 张工" }
      ],
      effectivenessSteps: [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "待处理", tone: "primary" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ],
      archiveResponsibilities: [
        "结算审批不经过董事长/总经理",
        "结算归档件由合同部成员上传",
        "归档由合同部主管确认",
        "财务只读取业务归档件"
      ],
      paymentRules: [
        {
          id: "current-settlement-payment",
          stage: "当期结算款",
          ratio: "80%",
          accountPeriod: "30天",
          triggerCondition: "结算归档确认生效",
          paymentRequestStatus: "未开放"
        },
        {
          id: "retention-payment",
          stage: "质保金",
          ratio: "20%",
          accountPeriod: "365天",
          triggerCondition: "质保期满",
          paymentRequestStatus: "未开放"
        }
      ],
      paymentBlockMessage:
        "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。",
      chainLinks: [
        { label: "关联合同", to: "/contracts/HT-2026-001" },
        { label: "付款申请", to: "/payments/FK-2026-006" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private statusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      approval_pending: { label: "审批中", tone: "primary" },
      approval_rejected: { label: "审批退回", tone: "danger" },
      withdrawn: { label: "已撤回", tone: "danger" },
      approved_pending_archive: { label: "待归档上传", tone: "primary" },
      archive_pending: { label: "待归档确认", tone: "primary" },
      pending_archive_confirm: { label: "待归档确认", tone: "primary" },
      effective: { label: "已生效", tone: "success" },
      rejected: { label: "已退回", tone: "danger" },
      voided: { label: "已作废", tone: "danger" }
    };

    return views[status] ?? { label: status, tone: "default" };
  }

  private nextActionLabel(status: string): string {
    const labels: Record<string, string> = {
      approval_pending: "等待结算审批",
      approval_rejected: "退回修改",
      withdrawn: "申请人已撤回",
      approved_pending_archive: "上传签章归档件",
      archive_pending: "主管确认归档",
      pending_archive_confirm: "主管确认归档",
      effective: "可创建付款申请",
      rejected: "退回申请人",
      voided: "无"
    };

    return labels[status] ?? "待处理";
  }

  private effectivenessSteps(status: string): SettlementDetailReadModel["effectivenessSteps"] {
    if (status === "effective") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "已确认", tone: "success" },
        { label: "结算生效", status: "已生效", tone: "success" }
      ];
    }

    if (status === "archive_pending" || status === "pending_archive_confirm") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "待处理", tone: "primary" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    if (status === "approval_rejected" || status === "withdrawn") {
      return [
        {
          label: "结算审批",
          status: status === "withdrawn" ? "已撤回" : "已退回",
          tone: "danger"
        },
        { label: "签字盖章归档上传", status: "未开始", tone: "default" },
        { label: "合同部主管确认", status: "未开始", tone: "default" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    return [
      { label: "结算审批", status: "处理中", tone: "primary" },
      { label: "签字盖章归档上传", status: "未开始", tone: "default" },
      { label: "合同部主管确认", status: "未开始", tone: "default" },
      { label: "结算生效", status: "阻塞", tone: "danger" }
    ];
  }

  private defaultPaymentRequestStatus(status: string): string {
    return status === "effective" ? "可创建" : "未开放";
  }

  private paymentBlockMessage(status: string): string {
    if (status === "effective") {
      return "结算已生效，可按绑定付款条款版本创建付款申请；付款比例和账期必须追溯当前版本。";
    }

    return "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。";
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
