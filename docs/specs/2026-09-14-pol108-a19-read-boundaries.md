# POL-108 第十九轮方案 A 读取边界补充

Owner 已明确批准 `/private/tmp/pol108-nineteenth-review-owner-decision-5a14e0d0.md`，
SHA256 `8b68f699e30eff22a7e3b47d8aaacde0d041ddbea41b207c23d3aa865375dc77`。
本补充接续 v1.3，限定 #108 非生产修复。

- CSV 成本列复用 shared-domain 八类一级中文标签；空值为空，非空未知码 409 整份拒绝。
  业务用途原文保留。不修改存储分类、写入或导出归属。发现合法二级成本码或无权威中文标签的受控用途枚举须停止补充决策。
- 仅无项目的既有报销、借款资金行恢复源单据 fundedAmountCents，供行金额、完成态归类和导航使用；SQL 计数与列表一致。
  零星费用不扩大本次兼容范围；项目行仍由投影提供金额，投影不完整时保持 null；非项目金额不进入项目经营总额。
- 同一只读 RR 事务内先运行实际读集 20,000 facts / 100,000 impacts / 64 MiB 总预算，
  再对有界限制来源 ID/行集合执行既有 20,000/40,000/8 MiB 检查。
  主体 fallback 保留；replacement 目标即使在 as-of 外也按 ID 去重计量。
  阈值、异常映射、15/30 秒超时、Schema、迁移及 #279/#280 写入语义不变。
- 重复指标面板提取为项目域组件；快照预算单测须确实经过目标查询后因目标预算拒绝。
- 两个 Security Low 继续延期：上游续页全项目指纹开销；导出密码确认/临时文件先于 limiter。

父 SHA `5a14e0d0fdd98846f3899474e779c8e54ce7f06f` 本地 PG16 169 迁移两遍、seed、
#108 14/14 和 release 16/16 均通过，但独立 Standards H0/M1/L2、Spec H0/M2/L0、
Security H0/M1/L2（去重 H0/M3/L4）阻断交付。其证据不得转移至新 SHA。
新固定 SHA 从头 targeted、类型/lint/UI、清单、PG16、完整 release、全新独立三审。
H0/M0 后才可恢复既有非生产 GitHub 交付。生产、部署、迁移执行、权限和真实数据操作禁止。
