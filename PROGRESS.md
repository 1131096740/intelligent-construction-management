# 建工智管 - 当前进度看板

> 本文件是项目的唯一进度登记入口，只保留当前结论、正在推进的事项、门禁和下一步。
>
> `AGENTS.md` 负责业务与工程规则；详细规格、运行证据和历史记录分别进入 `docs/specs/`、`docs/progress/` 与 GitHub Issues。
>
> 接手开发时先读本文件，再读 `AGENTS.md` 和相关领域文档；任何状态结论仍须与代码、Schema、迁移、测试、Git/CI、部署和生产只读证据交叉核验。

图例：`[x]` 完成 · `[~]` 已完成当前范围但有残余风险/持续观察 · `[ ]` 未完成

---

## 当前结论（更新至 2026-08-05）

- [x] 上线修复候选：`733ddb8192b95d11043c67da8b6e3965ec784680`。
- [x] 业务发布合并提交：`308c47b51c368a4573c9857411e59a872e1e5062`。
- [x] 最终上线决策：**Conditional Go**。
- [x] 精确 SHA CI、PostgreSQL 16 动态门、四类 `--require-ready`、RC-06 隔离业务长链、真实岗位 Chromium/WebKit 浏览器门、生产健康/备份只读核验及同机隔离部署 -> 回滚 -> 再部署均已通过。
- [x] 同机回滚演练仅使用 `127.0.0.1` 临时槽位、隔离数据库和本地文件存储，未修改正式生产业务数据。
- [~] 当前仅证明同一主机上的版本回滚能力；整机故障、跨主机接管及 DNS/入口网络故障转移未演练，继续作为已知残余风险。
- [x] 完整发布收据：[`docs/progress/2026-08-05-go-live-conditional-go.md`](docs/progress/2026-08-05-go-live-conditional-go.md)。

## 当前正在推进

### P0：仓库与协作控制面收敛

- [x] 根工作区恢复为干净 `main`，历史偏离状态已保存在独立 archive/recovery 分支，没有覆盖用户改动。
- [x] 旧脏 worktree 已先建立可恢复快照，再移除物理目录；恢复分支不得直接合并。
- [x] 建立 `CONTEXT-MAP.md`、文档导航、Issue/分诊/领域文档规则，并明确 `docs/superpowers/` 仅为历史资料。
- [x] 仓库控制面 PR #21 已合并为 `fc855cfef0d2ad0629cc7cc7dc6b9253993e7332`，且未触发部署。
- [x] GitHub 使用五态标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。
- [~] 根 `PROGRESS.md` 已压缩为实时看板；完整旧内容原样保存在历史快照中。
- [ ] 文档收敛 PR 合并后，复核最终 worktree/分支拓扑并归档旧 Codex 会话。

### P0：已删除草稿生命周期

- [x] 合同草稿删除与签署生命周期规格已收敛至 `docs/specs/2026-08-05-contract-draft-deletion-and-signing-lifecycle.md`。
- [x] GitHub 父 Issue #7 与 13 张子票 #8–#20 已建立，实施顺序和 blocking edges 已冻结；当前仅无 blocker 的 #8 标记为 `ready-for-agent`。
- [x] 规格已区分即时清理、审批型记录保留、数据库聚合、COS 全版本/删除标记及共享文件解除关联等边界。
- [x] 当前阶段仅提交规格并建立 Issues，未修改业务代码、Schema、迁移、COS 或生产数据。
- [ ] 实施从 Issue #8 的生命周期分类与能力投影开始，按依赖顺序逐票先写失败测试、再修复、验证和代码审查。
- [ ] Issue #8 尚未开始业务实现；#9–#20 在各自 blocking edge 解除前不得并行写共享 Schema 或权限模型。
- [ ] 未经单独授权，不修改生产业务数据、生产数据库记录或 COS 对象/生命周期规则。

### 上线后业务观察

- [ ] 合同部/法务对最新合同母版 DOCX 逐页人工签认，不以 PDF/PNG 自动检查代替。
- [ ] 按“发生后续结算/付款前先接管并确认余额”的原则继续完成历史合同接管，不把存量事实视为已全部初始化。
- [ ] 使用真实岗位验证首批合同、结算、付款、实付、凭证和归档闭环，并保留业务与财务签认。
- [ ] 继续抽查真实中文附件的移动端上传、受控下载、二次确认和审计记录。
- [ ] 在具备第二台生产等价主机后补做跨主机恢复与接管演练；完成前不得宣称完整灾备已验证。

## Go-Live 门禁状态

| 门禁 | 状态 | 当前证据口径 |
| --- | --- | --- |
| `POST /files` 权限旁路 | [x] | 岗位白名单、Guard -> ValidationPipe -> Service 顺序和拒绝路径已验证 |
| 结算审批过期状态 | [x] | 稳定 HTTP 409 / `SETTLEMENT_APPROVAL_REVIEW_CONFLICT`，并验证零写入 |
| 99 个治理 blocker | [x] | Web/page/route/capability manifests 均为 ready，无 blocker |
| 3 个重复 mutation route | [x] | 已收敛为领域唯一写入口，不以通配豁免隐藏 |
| CI 动态数据库门 | [x] | PostgreSQL 16：118 migrations、54/54 tests、28/28 files、9 groups |
| 四类 `--require-ready` | [x] | Web API、页面动作、route usage、capability matrix 全部硬门通过 |
| 最终 SHA 与差异证据 | [x] | CI/部署输入绑定候选 SHA；候选工作树和 `git diff --check` 已核验 |
| P0 与五包 Task 11 | [x] | 已纳入最终候选并通过候选级回归；详细过程见历史快照和发布收据 |
| RC-06 隔离业务长链 | [x] | 合同 -> 结算 -> 付款闭环与 20 个治理场景，`productionData=false` |
| RC-06 真实岗位浏览器 | [x] | Chromium 1366x768、WebKit 390x844；五类岗位及 400/403/409/503 |
| 503、双击幂等、移动文件链 | [x] | 写冻结 503、并发上传幂等、上传下载内容回读均有证据 |
| 备份隔离恢复与监控 | [x] | 自然异机备份、checksum、隔离恢复、健康/readiness 和监控证据通过 |
| RC-09 / 阶段 F | [~] | 同机隔离部署 -> 回滚 -> 再部署通过；跨主机与整机故障未演练 |

## 生产与运维边界

- 生产业务写入、账号/权限变更、数据库修复、COS 对象删除或生命周期变更必须获得单独明确授权。
- 日常备份巡检默认只读，只验证自然 Cron 产物、checksum、`pg_restore --list`、异机回执、日志/进程和公共健康状态。
- 发生发布异常时先停写、确认当前运行 SHA 与最新可恢复备份，再按 runbook 回滚；不得在证据不完整时继续迁移或写入。
- 精确候选 SHA 发生任何代码变化后，旧的 CI、数据库、浏览器和生产证据不再自动适用，须重新绑定并运行受影响门禁。
- 当前生产为单机部署；自然异机备份是数据恢复控制，不等于应用跨主机高可用。

## 模块状态

- [x] 核心业务闭环：合同草稿、审批、用章、归档、生效、结算、付款申请、实付、凭证、财务记录、PDF 与审计已具备。
- [~] 审批引擎：实例冻结、会签、或签、撤回、退回、转审、委托和催办覆盖核心链路；条件节点仍缺显式合同类型字段，后续变更继续以服务端状态机为准。
- [x] 认证与授权：手机号密码、强制改密、项目岗位权限、敏感动作校验和审计已覆盖当前生产范围。
- [~] 文件/PDF/审计：私有存储、短时效下载、二次确认和审计已覆盖主要链路；真实业务附件继续观察。
- [~] Web Admin：桌面与手机共用 Vue 3 + TDesign 响应式 Web；真实尺寸和业务长链持续验收。
- [~] 小程序退出：目标架构已决定，但 `apps/miniprogram`、微信登录入口和 `wxOpenid` 清理尚未按两阶段计划实施。

## 不在当前 P0 范围

- OCR/AI 批量识别、开票、考勤、人事、安全、完整物料领用和大型经营驾驶舱。
- 已签历史合同重走合同审批；历史合同继续按接管、余额确认和后续业务触发原则治理。
- 未经重新定界，不新增第二套 UI 库、低代码运行时、通用工作流引擎或全站重写。

## 历史与证据索引

- 本次压缩前的完整进度快照：[`docs/progress/full-history-snapshot-through-2026-08-05.md`](docs/progress/full-history-snapshot-through-2026-08-05.md)
- 2026-07-07 以前的早期历史：[`docs/progress/full-history-through-2026-07-07.md`](docs/progress/full-history-through-2026-07-07.md)
- 当前发布收据：[`docs/progress/2026-08-05-go-live-conditional-go.md`](docs/progress/2026-08-05-go-live-conditional-go.md)
- 文档导航：[`docs/README.md`](docs/README.md)
- 文档有效性索引：[`obsidian-current/建工智管_文档有效性索引.md`](obsidian-current/建工智管_文档有效性索引.md)
