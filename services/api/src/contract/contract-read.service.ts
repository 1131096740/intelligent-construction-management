import { Injectable } from "@nestjs/common";
import { ContractDetailReadModel } from "@jiangkong/shared-domain";

@Injectable()
export class ContractReadService {
  getDetail(contractId: string): ContractDetailReadModel {
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
}
