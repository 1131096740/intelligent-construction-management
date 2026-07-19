# 合同结算治理发布候选验收记录

> 状态：窗口 A 已于 2026-07-19 受控完成；技术发布和生产只读验证通过，真实业务/财务签认仍待完成
> 候选分支：`codex/contract-tax-facts-pricing`
> 40 位不可变运行候选 SHA：`74d5d2449ab9e4232f2625f2805c64b1686ff314`
> 获批证据 HEAD / 当前 `origin/main` / 生产 SHA：`4b5b6f0a7dbb0b3271b63d682b00967bd81e1452`
> 生产迁移：69 个，未完成 0，回滚 0
> 结论：**窗口 A 技术发布成功；窗口 B 不存在且未执行。全面业务 Go-Live 仍等待真实业务/财务签认。**

### 发布审计的双 SHA 模型

- **运行候选 SHA** 永久固定为 `74d5d2449ab9e4232f2625f2805c64b1686ff314`；本文档记录的全量测试、精确 UAT 和 76 张截图均绑定该 SHA。
- **证据/文档 HEAD** 是包含本报告和机器证据的后续仅文档提交；它不得改变运行时代码树，也不得冒充已在该文档 HEAD 上重跑 UAT。
- 后续发布授权必须同时指明当时的证据/文档 HEAD 和上述运行候选 SHA，并以 `git diff --quiet 74d5d2449ab9e4232f2625f2805c64b1686ff314 <证据 HEAD> -- services packages apps .github scripts/ops` 校验确认运行树零差异。

## 1. 候选范围

本候选将 2026-07-17 已批准的七块合同结算治理规格收口为一个可独立审计的发布单元：

1. 新合同审批；
2. 签署、用印与归档；
3. 双方授权委托书；
4. 合同变更与累计正增项 10% 上限；
5. 结算单、乙方签章与我方冻结签名；
6. 税务与计价事实；
7. 我方公司主体及历史接管主体匹配。

当前候选共有 **69 个迁移**，生产当前已知共有 **61 个迁移**。本次生产尚未部署的治理迁移为 **M52–M58**，以及最终统一文件业务绑定守卫 **M69**；M59–M68 已属于当前生产 61 个迁移事实，不计入本候选待部署增量。M52 是本实施开始前已存在且全程保持不变的税务与结算草稿基线，本轮合同结算治理新增为 M53–M58，合并主线后新增 M69：

| 序号 | 迁移 | 范围 |
| --- | --- | --- |
| M52 | `20260716160000_contract_tax_facts_and_settlement_drafts` | 税务事实和结算草稿基线，本实施期零改动 |
| M53 | `20260717110000_company_entity_versions_and_contract_subject_snapshots` | 我方主体版本和合同主体冻结快照 |
| M54 | `20260717120000_approval_assignee_and_signature_snapshots` | 审批候选人、代表人、岗位和签名快照 |
| M55 | `20260717130000_contract_formal_documents_authorizations_and_seal_tasks` | 合同正式件、授权、审批单和用章任务 |
| M56 | `20260717140000_settlement_participants_and_signed_documents` | 结算参与人和签章文档 |
| M57 | `20260718100000_payment_request_frozen_stage` | 付款申请冻结付款阶段 |
| M58 | `20260718110000_contract_takeover_company_entity_corrections` | 历史主体错配两步更正证据 |
| M69 | `20260719100000_unified_file_business_binding_guard` | 统一 54 个文件业务引用的完整性守卫和 54 个数据库触发器 |

M69 已在 PostgreSQL 16 隔离环境完成两条完整迁移路径验证：fresh **M1→M69** 和当前 `origin/main` 对应的生产基线 **61→69** 均通过；最终清单为 54 个文件引用、54 个触发器，旧守卫函数清理完成，并覆盖普通更正附件复用、主体更正附件冲突、替换链、无变化更新和双事务并发单赢家场景。该证据不等同于生产备份恢复演练。

生产备份恢复演练原绑定 `e47129ba637caf58d02a7206872fbdd53a606d17`。已对 `e47129ba…`→`74d5d244…` 的 `services/api/prisma/schema.prisma`、`services/api/prisma/migrations` 和 `services/api/prisma/transition-contract-settlement-governance.cjs` 执行树差异核验，结果为零差异；因此该恢复证据对当前运行候选等价，但不宣称在 `74d5d244…` 上重复执行了生产备份恢复。

## 2. Git 与差异证据

| 项目 | 结果 |
| --- | --- |
| 最新 `origin/main` | `99d3859429ff135b07e083dd7ebeb345d85e9bed`；其相对运行候选仅新增 `PROGRESS.md`，已合入后续证据 lineage |
| 运行候选 SHA | `74d5d2449ab9e4232f2625f2805c64b1686ff314` |
| 对 `origin/main` 提交列表 | 运行候选侧 96 个提交、落后 1 个仅文档提交；证据 HEAD 已合并该提交 |
| 对生产 `89e434da…` 提交列表 | 96 个提交、0 个落后 |
| 实际修改文件清单 | 运行候选相对 `origin/main` 和生产均为 334 个文件；机器清单分别为 `docs/progress/evidence/2026-07-19-contract-governance-74d5d244/origin-main.name-status.txt` 和 `production.name-status.txt` |
| 迁移差异 | 候选 69、生产 61；生产待部署为 M52–M58 与 M69 |
| 受保护生产运维文件意外差异 | 通过；相对 `origin/main` 和生产的 `.github`/`scripts/ops` 意外差异均为 0 |

## 3. 自动化门禁

> 下列结果精确绑定运行候选 `74d5d244…`。后续仅文档证据提交不重跑也不冒充该运行时验证。

| 门禁 | 结果 | 证据/条件跳过原因 |
| --- | --- | --- |
| shared-domain 定向与全量测试 | 通过 | 102/102 |
| API 定向与全量测试 | 通过 | 177 suites 通过、4 suites 条件跳过；3921 passed、15 skipped |
| Web 定向与全量测试 | 通过 | 98 个文件、785/785 |
| Prisma validate / generate | 通过 | validate 与 generate 均通过 |
| typecheck / lint | 通过 | shared、API、Web 对应 typecheck/lint 全部通过 |
| `check:business-errors` / `check:ui` | 通过 | 两项治理检查均通过 |
| API / Web production build | 通过 | 两端 production build 均通过 |
| P0 E2E | 通过 | 53 passed、2 conditional skipped |
| 精确 SHA 浏览器回归 | 通过 | 3/3 视觉用例，六视口共 76 张 PNG |
| `git diff --check` | 通过 | 候选工作树洁净 |

## 4. 隔离 UAT 矩阵

`verify-trial-run.cjs` 的完整模式必须绑定当前 40 位候选 SHA 和脱敏隔离 UAT 证据清单；缺少任一必选场景都会失败。`--preflight` 仍只做本地 API、数据库和文件存储安全检查，不写业务数据。

| 场景 | 结果 | 脱敏证据编号 |
| --- | --- | --- |
| 五类合同路线 | 通过 | `task22-final-74d5d244-20260719a` 证据清单 |
| 合同部主管发起跳过自审 | 通过 | 同上 |
| 董事长/总经理最终或签 | 通过 | 同上 |
| 双方授权四种组合 | 通过 | 同上 |
| 用章、线下签署、双方最终版与归档 | 通过 | 完整 P0-5B HTTP 链路 |
| 累计正增项 9.99% / 10% / 10.01% | 通过 | `task22-final-74d5d244-20260719a` 证据清单 |
| 材料/机械结算路线 | 通过 | 同上 |
| 劳务/专业分包结算路线 | 通过 | 同上 |
| 单页/多页结算单签名 | 通过 | 同上 |
| 通用合同直接付款 | 通过 | 同上 |
| 跨域只读正向与写入负向 | 通过 | 同上 |

最终精确 SHA 隔离执行事实：

- runId：`task22-final-74d5d244-20260719a`；Git HEAD：`74d5d2449ab9e4232f2625f2805c64b1686ff314`。
- 机器证据：`docs/progress/evidence/2026-07-19-contract-governance-74d5d244/governance-uat.json`，SHA-256 `8e433478da8a2ea472c4997e949c00b88022da41ec77bff1560b5794cfe7e692`，20/20 均为 `passed=true`。
- 完整业务链：`HT-UAT-task22-final-74d5d244-20260719a` → `JS-UAT-task22-final-74d5d244-20260719a` → `FK-UAT-task22-final-74d5d244-20260719a`。
- 只使用一次性本地 PostgreSQL、本地 API 和本地文件存储，`productionData=false`；临时资源均已清理。

证据是从洁净运行候选生成的机器输出；后续仅文档证据 HEAD 不需也不得被记录为另一次运行时 UAT。

隔离 UAT 真实发现并关闭两个 P0：

1. 合同变更并发锁 SQL 对 `UNION` 使用 `FOR SHARE`，PostgreSQL 拒绝执行；拆分为合法锁查询后，真实双连接并发回归 23/23 通过。
2. 新治理结算的归档确认事实保存在已确认的 `final_internal_signed_copy`，付款/项目容量仍只读取旧 `SettlementArchiveFile`，导致合法结算可申请金额为 0；新增统一双读并按结算取最早确认时间，付款请求、付款预览和项目代付容量统一复用，定向 287/287、API typecheck/lint 通过，随后完整 UAT 付款闭环通过。

## 5. 浏览器验收

| 视口 | 页面范围 | 结果 | 截图目录 |
| --- | --- | --- | --- |
| 1512×982 | 主体、五类合同、详情/变更、材料/劳务结算、付款、只读台账 | 通过 | `/tmp/jiangkong-release-74d5d244-20260719a/screenshots`（清单已固化入 `docs/progress/evidence/2026-07-19-contract-governance-74d5d244/screenshot-sha256.txt`） |
| 1440×900 | 同上 | 通过 | 同上 |
| 1280×800 | 同上 | 通过 | 同上 |
| 1180×820 | 同上 | 通过 | 同上 |
| 1024×768 | 同上 | 通过 | 同上 |
| 900×768 | 同上 | 通过 | 同上 |

精确 SHA 视觉回归 3/3 通过，六视口共 76 张 PNG；截图清单 SHA-256 为 `46dbe0d0c0f5d293f052d3d792cb972635d53fdccaab4d48c3743dee05878f84`。P0 E2E 为 53 passed、2 conditional skipped。硬性验收：根文档横向溢出 `0`，嵌套横滚 `0`，`pageerror` `0`。

## 6. 隔离库迁移与旧实例过渡演练

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 生产备份恢复至 `jiangkong_restore_*` | 通过 | 使用异机回读 custom dump，备份 SHA-256 `7a961c4caa0d07dd73f6076438610a21cd77603db6aeaf9d5c95670780e3462e` |
| 生产 61 个迁移事实 | 通过 | 恢复前 `61|0|0`；当前生产代码已更新为 `89e434da7cde3ef30800b9f458b9b5ee59305de9`，迁移数未变 |
| fresh M1–M69 在本地 PostgreSQL 16 隔离库依次应用 | 通过 | 69/69 迁移通过 |
| `origin/main` 61→69 在本地 PostgreSQL 16 隔离库应用 | 通过 | 61→69 迁移通过；不是生产备份恢复 |
| M69 文件业务引用/触发器清单 | 通过 | 54 个引用、54 个触发器；并发单赢家等边界通过 |
| 存量结构与核心计数只读核验 | 通过 | 113 张 public 表；User 11、Project 1、Contract 4、ContractTakeover 1、Settlement/PaymentRequest 0、FileObject 14、AuditLog 185 |
| 金额、税务和历史审批聚合核验 | 通过，但真实初始化待办 | 4 个合同版本金额负值 0；4 个税务事实均未确认、非法税率 0；审批实例/动作均为 0，无历史 JSON 需过渡 |
| 我方主体与文件引用核验 | 结构通过，真实初始化待办 | 我方主体当前 0 条；FileObject 14、自替换 0；绑定列 54，其中独占列 10 |
| M69 运行结构 | 通过 | 54 个触发器、5 个统一函数、0 个旧函数 |
| transition preview manifest 与摘要 | 通过 | 恢复演练 SHA 上精确 CLI，且与 `74d5d244…` 的迁移/transition 树零差异；`itemCount=0`、`blockedCount=0`，digest `4cfe129a3db1737283bf593018dc88be5adf7a007d85db93a1c72e86108b6876` |
| 隔离库 manifest apply | 不适用 | preview 为空，没有存量实例可写；不为证明 apply 人工造数据 |
| 漂移整批回滚 | 非空 manifest 时才适用 | 开发期模块级演练通过；本候选 preview 为空，不伪造实例 |
| 重复 apply 幂等 | 非空 manifest 时才适用 | 开发期模块级二次 `applied=0`、`alreadyProcessed=2`；本候选不执行 apply |
| 付款/实付/入账零改动 | 通过 | 生产备份隔离只读核验，本候选 transition 业务写入为 0 |
| 隔离库清理 | 通过 | 隔离数据库、候选 checkout、恢复输入和 bundle 已删除；正式备份收据保留 |

本地 transition 行为演练收据：runId `task22-20260718T160702Z`，执行时 Git HEAD `2bef123cfbdc231cba41d212b17ed6f9cd5f0c30`，PostgreSQL `16.14`，M1–M58 共 58 个迁移；manifest digest 为 `a4ac20b349f0a157228d072d876cfad7c8dd70f82a06beaa2703930a0eee24fc`，manifest 文件 SHA-256 为 `8f7e8f7c0175e690a1625e55dc5f25262605f22d54a0ea7aaee91ca6abdb4c5d`。首次 apply 为 2/0，第二次幂等 apply 为 0/2；漂移批次被整批拒绝且 transition 审计、替代草稿写入均为 0；付款申请、实付、入账与已付金额事实不变。机器收据 `/tmp/task22-20260718T160702Z-transition-evidence.json` 的 SHA-256 为 `67a272e0378033bd77c35783ffbd90c0bca009fff5fec48d8aa5999f03424bdf`，harness cleanup 通过。

边界：开发期的 2 对象 apply/幂等/漂移演练仍是模块级证据；精确候选在生产备份恢复库上只发现空 manifest，因此本次没有可执行的 apply/幂等/漂移对象。历史生产 `super_admin` 用户 ID 为非 UUID，而 CLI 当前只接受 UUID 操作人；它不阻断本次空 preview 与发布，但若未来出现非空过渡清单，必须先完成操作人兼容性修复并重跑门禁。

## 7. 已知问题与 Go / No-Go

- 当前精确运行候选的自动化、构建、P0 E2E 与六视口浏览器门禁已通过，窗口 A 已按获批证据 HEAD `4b5b6f0a…` 发布成功。
- 运行候选 SHA、精确 SHA 隔离 UAT、transition preview 和生产备份 61→69 恢复门禁已完成。
- 约 20 个历史合同、3–5 个活跃合同、合同/结算母版逐页验收和普通岗位权限矩阵签认仍未完成。
- 生产备份中我方主体为 0 条，4 个现有合同版本的税务事实均未确认；上线前必须由合同部/综合部录入启用的我方主体，并由财务与合同部完成现有合同税务事实确认或试运行处置签认。
- 推送、部署和生产迁移授权已执行完毕；Actions `29683793910` 成功，生产为 `4b5b6f0a…` / `69|0|0`。
- 即使部署/迁移被批准，也不等于批准 transition manifest 的生产业务写入。
- 生产历史合同批量接管、3–5 个活跃合同长链路、母版逐页验收和普通岗位矩阵签认仍是真实试运行门禁，不能被脱敏自动 UAT 取代。

### 7.1 2026-07-19 窗口 A 生产执行收据

- 用户批准：证据 HEAD `4b5b6f0a7dbb0b3271b63d682b00967bd81e1452`、运行候选 `74d5d2449ab9e4232f2625f2805c64b1686ff314`、推送/部署/M52–M58/M69/生产验证。
- 推送：候选分支与 `main` 原子快进到 `4b5b6f0a…`；运行候选到证据 HEAD 的 `apps/services/packages/.github/scripts` 运行树差异为 0。
- Actions：`29683793910`，Verify build 与 Deploy to server 均成功；类型、Lint、业务错误、安全自检、全量测试、构建、UI 治理和生产构建 P0 E2E 全部通过。
- 发布前备份：`jiangkong-20260719-185424.dump`，521315 字节，`root:root 600`，checksum 与异机收据通过。
- 迁移：逐条应用 M52–M58 与 M69，最终 `69|0|0`；M69 只读核验为 54 个引用、54 个触发器、5 个统一函数、0 个旧函数。
- 运行状态：服务器 HEAD、`origin/main` 和获批证据 HEAD 一致；API、Nginx、PostgreSQL、Cron active，公网 Web/API 200，TLS 证书有效至 2026-09-29，发布后 API/Nginx error/alert 日志为空。
- 业务写入边界：`governance.transition.*` 审计 0、transition 终止审批 0、付款申请 0、实付 0。生产只读 preview 为 0 项/0 阻断，digest `bf686072b5b43cbb2fe2f3db815d562dd72da524c7d48dcce518a41ca9064002`；未执行 `--apply`，临时 manifest/worktree 已清理。
- 剩余真实签认：我方主体仍为 0 条、4 个现有合同版本税务事实未确认；约 20 个历史合同、3–5 个活跃合同、真实母版/附件和普通岗位权限矩阵仍需业务与财务验收。

## 8. 回滚边界

- 应用回滚：保留上一生产 SHA 和 Web/API 快照；新格式业务事实已产生后不得盲目回退旧代码。
- 数据库：M52–M58 与 M69 均按前向兼容设计；不执行自动 down migration，故障使用经审查的前向修复。
- 数据恢复：只先恢复到 `jiangkong_restore_*` 隔离库核验；恢复生产需新的维护窗口和单独授权。
- 业务过渡：生产 transition 只能使用经用户单独批准的精确 manifest；终止旧实例不删文件、不删日志、不改付款事实。
