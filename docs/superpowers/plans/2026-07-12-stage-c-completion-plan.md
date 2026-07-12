# Stage C Contract Workbench Completion Plan

**Goal:** 完成业务场景选模、Office 模板版本、Word 往返差异、正文画布与合同变更新版本闭环，同时保持结构化账本和历史版本引用不漂移。

## C1 Office 版式草稿治理

- Layout version 增 draftRevision/inspectionRevision，preview job 绑定 sourceRevision。
- 新增模板详情与倒序版本；draft 才可 CAS 更换 DOCX/placeholder schema，换源后旧检查/预览全部失效。
- publish 必须检查 inspection/preview revision 等于当前 draftRevision；Web 移除手填内部版本 ID，clone 后选中新草稿。

## C2-C3 Word 修订预览与差异 Gate

- offline revision 绑定来源生成文档及 sourceRevision，异步生成 PDF，可预览、下载、重试并保留历史。
- 新增 negotiation round、comparison、difference；确定性提取 DOCX 段落/表格，金额、日期和关键条款只生成结构化候选，不自动覆盖账本。
- 差异必须逐项标记回填确认、拒绝或无实质变化；未完成比较、开放轮次、待处理差异阻断提交审批，所有动作审计。

## C4 正文画布与业务侧栏

- 最新成功 generated/revision PDF 作为中央只读画布；现有结构化组件收进右侧 TDesign tabs/drawer，顶部保留阶段、保存状态和唯一主操作。
- readiness 始终可见；无文档时明确生成下一步；不引入在线 Office 或第二套 UI。

## C5 合同变更/补充协议

- effective 合同可创建唯一活跃变更草稿；新版本复制模板/版式/主体/字段/条款/清单/付款条款快照，记录 baseVersionId、changeType、changeReason。
- 变更版提交保留原合同编号，不重新分配；复用审批、用印、归档。
- 新版归档生效时同事务 CAS 旧 effective -> superseded；新结算只接受最新 effective，历史结算/付款原 versionId 不改。
- 实现已批准的补充协议白名单与金额增加/减少累计、原合同固定基数 10% 加强审批规则。

## C6 可配置业务场景推荐

- 新增业务场景及场景到 contractType/模板版本的受控映射、优先级、推荐理由和启停状态；不硬编码或虚构真实场景。
- 合同主管配置，普通用户只读；新建流程为项目 -> 场景 -> 推荐模板 -> 预览/更换兼容模板 -> 草稿。
- 合成测试数据证明 0/1/N 推荐行为；真实场景映射属于后续业务初始化输入。

## Verification

- 陈旧检查/预览阻断、published 不可修改、DOCX/PDF 修订历史、坏文档 fail closed、差异处理与提交 gate。
- 变更复制隔离、并发单草稿、旧引用稳定、旧版不能新增结算、编号不重分配、OR 签与 10% 加强节点。
- 1440/1100 视口核心工作流、API/Web full gates、独立规格/质量复审。
