# Task 6 提交前正式编号处置预检

日期：2026-07-29

## 结论

Release A 后的生产只读预检只有一条阻断：

```text
FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION
```

只读复核证明它不是 seed、历史接管或手工改库造成的异常。该记录由生产系统在
2026-07-28 创建；旧版本 API 于 2026-07-29 06:52:20 在首次手动保存时按当时的
正式业务规则分配编号，审计 metadata 中的编号与当前编号完全一致。候选
`f28071b4` 之后才把分配点移到提交审批事务，因此这是一条可解释的版本切换事实，
但仍不能伪造为“已经提交”。

当前实施计划要求合同部主管对该编号明确选择“保留”或“作废”，且已分配序号不回收
重用。Release A 候选只有阻断检查，没有固化该人工决定的受控入口；本轮已补齐工具
与失败关闭验证，但没有推送、合并或修改生产。

## 生产脱敏事实

| 事实 | 只读结果 |
| --- | --- |
| 记录数 | 1 |
| 来源 | `system` |
| seed | 否 |
| 版本状态 | `draft` |
| 变更类型 | `original` |
| 当前 revision | 11 |
| 经办人 | 已绑定 |
| 临时编号 | 仍保留 |
| 正式编号形态 | 当前 `HT-YYYYMMDD-NNN` 日序格式 |
| 合同治理版本 | 1 |
| 结算方式 | `settlement_required`，尚未主管确认 |
| 审批实例/提交收据/提交审计 | 0 / 0 / 0 |
| 草稿保存收据 | 0 |
| 清单 | 1 张、11 行 |
| 主体快照 | 1 |
| 付款条款版本 | 1 |
| 草稿附件/成功生成文档 | 0 / 0 |
| 正式文件/归档文件/授权 | 0 / 0 / 0 |
| 接管/结算 | 0 / 0 |
| 审计链 | 创建 1、保存 8、主体绑定 1 |

正式编号第一次出现在唯一一条带 `formalCode` 的 `contract.draft.save` 审计中，
并与当前编号相符。没有证据支持直接回填 `firstSubmittedAt`、创建审批实例或把它
认作曾提交合同。

## 新增受控处置

新增：

- `services/api/scripts/resolve-contract-draft-formal-code.cjs`
- `pnpm --filter @jiangkong/api resolve:contract-draft-formal-code`

处置必须绑定：

- 30 分钟内、未截断的生产只读预检报告；
- 数据库 fingerprint 与报告 SHA-256；
- 精确 `contractVersionId`、当前 revision 和正式编号 SHA-256；
- 活跃合同部主管 UUID；
- `retain` 或 `void` 明确决定；
- 5–500 字符业务原因；
- 包含版本 ID 和决定的精确确认串。

执行在单一 `Serializable` 事务内重新锁定合同和版本，并重新证明：

- 状态仍为 `draft/returned/withdrawn`；
- revision 未变化；
- `firstSubmittedAt` 仍为空；
- 合同审批实例仍为 0；
- 正式编号 SHA-256 仍与报告一致；
- 操作者仍是该项目可用的合同部主管。

两种结果：

| 决定 | 写入 | 后续含义 |
| --- | --- | --- |
| `retain` | 只新增一条 `contract.draft.formal_code.disposition` 审计；编号和 revision 不变 | 新预检只有在审计中的决定和编号 SHA 精确匹配时才解除该阻断 |
| `void` | CAS 清空 `Contract.code`，`draftRevision + 1`，新增同一审计 | 原序号永久不回收；以后正常提交审批时分配新编号 |

审计只保存决定、原因、编号 SHA、报告 SHA、前后 revision 和“不回收”事实，不重复
保存编号明文。重复的同编号 `retain` 为零写幂等；编号、revision、审批事实、角色或
报告漂移均整笔回滚。

预检和 transition 在锁定后都会重新读取最新处置审计。仅 `retain` 且编号 SHA
完全匹配时，已有编号但未提交的草稿才可被重新分类为 `ready`；陈旧或不同编号的
处置不能解除阻断。

## 验证证据

- RED：处置脚本不存在，readiness 不输出编号 SHA，也不识别精确保留决定。
- GREEN：readiness、处置工具、transition 目标 Jest 3 套 20/20。
- API 全量 Jest：251 套通过、15 套条件跳过；4,749 通过、38 跳过。
- API typecheck、lint、build：通过。
- Prisma validate、Prisma Client generate：通过。
- 三份脚本 `node --check`、`git diff --check`：通过。
- 无 Prisma Schema 或迁移变化。

全量 Jest 的 Fontconfig 输出是当前沙箱没有可写字体缓存的环境提示；测试退出码为
0，PDF/水印等相关套件均通过。

## 合同部需要作出的业务决定

### A. 保留现编号

适用于合同部确认该编号虽由旧版本首次保存分配，但仍是这份真实草稿应继续使用的
正式编号。受控工具只增加一条审计确认，不伪造提交时间或审批实例。

### B. 作废现编号

适用于合同部确认该编号不应继续用于这份草稿。工具清空当前编号并递增 revision；
原编号只留在既有审计和处置收据中，永不回收。草稿以后真正提交审批时取得新编号。

### C. 由经办人完成真实业务提交

如果合同已经准备进入审批，也可以先由合同部主管确认结算方式并补齐 readiness，
再由经办人通过正常页面提交。提交事务会产生真实 `firstSubmittedAt`、审批实例和
提交审计，现编号继续使用。该路径包含真实业务写入，不能由发布任务代办或伪造。

禁止路径：

- 直接回填 `firstSubmittedAt`；
- 人工插入审批实例；
- 删除审计或重置日序；
- 作废后回收编号；
- 通过逻辑删除草稿绕过预检。

## 后续授权门

继续 Task 6 至少需要分别明确：

1. 合同部选择 A、B 或 C；
2. 是否允许推送新脚本候选并 fast-forward `main` 与生产 checkout；
3. 若选 A/B，是否允许对这一个精确版本执行对应处置业务写入；
4. 处置后重新生成生产只读报告；
5. 报告变为全量 `ready` 后，另行授权维护窗口与 transition apply。

本文件不构成上述任何授权。
