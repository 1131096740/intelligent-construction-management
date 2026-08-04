# 实施包 5 Task 11：合同清单未实施余量取消

日期：2026-08-01

## 当前结论

本切片闭合现行能力：

- `POST /contract-bills/:billId/rows/:rowKey/remainder-cancellation`

合同变更把旧版本清单的历史履约数量带入新版本后，当前经办人现在可以在合同工作台对精确
清单行执行“取消未实施余量”。该动作不是删除历史清单、结算或映射，而是把目标行合同数量
收敛为累计不可逆历史履约数量，并以专用审计回执记录原因、旧值、新值和并发坐标。已经发生
的履约、结算、付款、跨版本映射和 carry-forward 快照均保留。

本切片完成了失败测试、后端累计占用口径、专用串行事务、普通写入口防绕过、工作台入口、
fresh preflight、结果未知保护，以及全站/合同专项能力矩阵收口。它只闭合 Task 11 的一个独立
切片，不代表 Task 11、实施包 5 或五包发布候选完成。

本轮未连接生产，未推送、合并、部署、执行生产迁移或修改生产业务数据；没有执行 retention、
transition、业务草稿 purge、正式业务记录删除、AuditLog/checkpoint 清理、旧表旧字段删除或
其他物理删除。

## RED 与最小实现

### 先行失败证据

新增失败测试先锁定以下缺口：

- 旧版本有效结算数量与多代 carry-forward 没有统一为目标行的累计不可逆占用；
- 可撤回、退回或尚未归档的结算可能被误算为已完成历史，或在仍可变化时开放余量取消；
- 相同总量但来源结算行、结算单或映射证据变化时，旧坐标可能被错误复用；
- 当前行普通删除、逐行修改、聚合保存、Excel 整表替换和 checkpoint 恢复可绕过历史占用；
- 专用动作缺少 lease、草稿/清单双 revision、占用 token、原因和项目动作权限；
- 工作台没有服务端派生入口，也没有“先保存完整聚合、再读取最新能力、再单次提交”的页面链；
- POST 已提交但响应或权威刷新失败时，页面可能错误允许自动重试；
- 全站动作清单最初无法验证复杂页面 handler 的因果链，合同专项检查器也只识别 exported
  wrapper 内的直接 transport，误把 private helper 中的真实 POST 记为无前端入口。

上述用例均先出现失败，再进入最小实现。合同专项检查器新增的 private-helper fixture 精确从
`wrapper=null / backend_without_frontend` 失败，修复后才变为唯一 exported executor 的
`matched`。

### 累计占用与激活不变量

共享占用计算现在明确分离：

1. 不可逆历史只累计 carry-forward 与 `effective`、`partially_paid`、`paid` 结算行；
2. 可逆结算占用单独返回并禁用取消，不污染最终历史数量；
3. 多代合同变更按 lineage 累加 carry，不把上一代快照当作仅一代事实；
4. 相同 lineage 自动一对一映射还必须单位一致，单位漂移失败关闭；
5. 手工拆分、合并或换单位只使用主管确认且数量/金额守恒的 target allocation；
6. 无历史分配的新行写入精确 `Decimal(0)`，只有来源事实本身未知时才保留未知并阻断；
7. 占用 token 对结算、结算行、映射和数量证据规范排序；即使总量相同，证据身份变化也会使
   token 变化；
8. 已取消余量的目标行在后续合同版本激活前必须仍精确等于最新累计历史数量，否则在
   transition、carry 和版本替换写入前阻断。

活动来源行缺数量、V2 carry 快照缺失、映射边丢失、手工映射未确认或不守恒时均失败关闭，
不会把未知值猜成零。

### 专用写事务与防绕过

`ContractBillService.cancelRemainder()` 现在：

- 要求 `contract.create`、当前编辑租约、`expectedDraftRevision`、`expectedBillRevision`、最新
  `expectedOccupancyToken` 和 1..500 字原因；
- 使用 Serializable 事务并按合同草稿、清单和行的既有锁序复核 owner、可编辑状态、租约、
  双 revision、行身份、单位与最新累计占用；
- 只允许目标合同数量大于历史数量且没有可逆占用时执行；重复取消、历史数量不完整、坐标漂移
  均在 revision、行和 Audit 写入前拒绝；
- 将数量精确收敛到累计历史数量，按现有权威 Decimal/金额规则重算行与清单合计，只增加一次
  清单 revision 和草稿 revision，并写一条专用 Audit；
- 不删除旧行、旧结算、旧映射、旧快照或任何审计记录。

普通逐行修改/删除、聚合保存、批量替换、Excel apply、跨版本 transition 和 checkpoint 恢复
全部复用同一历史占用策略。已取消行不能通过普通保存再次扩回或改写；普通数量调整只有在仍高于
历史数量且单位不变时才允许。

### Web 动作

合同工作台 GET 一次批量投影每行的精确事实和 action，并另发布服务端派生的顶层
`contract-bill.remainder-cancellation` capability；非 owner、只读草稿、事实不完整或任一相关
行存在可逆占用时入口保持可见但禁用并返回原因。

清单聚焦编辑器把历史占用行的普通删除替换为独立危险动作。确认前核对行 fingerprint、原因、
服务端 action 和治理事实；页面随后：

1. 保存当前完整合同草稿聚合；
2. 以精确 `contractVersionId` fresh GET 工作台；
3. 核对 owner、route、租约、草稿/清单 revision、行、action 和占用 token；
4. 只提交一次编码后的 billId/rowKey POST；
5. 成功后权威重读工作台。

跨路由、租约或组件 owner 漂移时停止提交。网络中断、408/5xx、响应无法解析均标记为
`RESULT_UNKNOWN`；POST 已确认但刷新失败时显示“已提交、不要重复提交”并锁住该行重试，直到
用户手动刷新。Excel 候选或本机恢复副本遗漏/重复治理行时失败关闭，保存前会剥离所有服务端
capability 字段。页面没有直接 `fetch`。

## 治理矩阵

新动作 `contract-bill.remainder-cancellation` 已满足：

- `serverDerived=true`
- `dominatesTrigger=true`
- GET preflight 与 POST mutation 均 `causalVerified=true`
- POST 要求 `contract.create`，与 fresh GET 授权一致
- exported executor 有唯一生产页面消费者，private transport helper 未暴露为孤儿 wrapper

全站综合矩阵将 POST 判定为 `covered`；合同专项检查器现在只从 exported wrapper 出发，递归
其调用的非 exported 顶层 helper，并用 visited 防循环、按 route key 去重，不穿透另一个
exported wrapper。对应专项矩阵由 `backend_without_frontend` 修正为 `matched`，没有通过重新
导出底层 transport 制造 `ORPHAN_WRAPPER`。

本轮重生成后的全局基线为：395 条后端路由、381 个 Web transport wrapper、395 个 main
request binding、43 条退出候选、3 条 `unclassified`、51 个登记动作、296 个 page blocker、
320 个综合矩阵 blocker。全局仍保持 `blocked` 是因为 Task 11 后续项目垫资额度动作和既有全站
缺口，不是本动作回退。

## 验证证据

- 目标 API：12/12 套、373/373；
- 目标 Web：6 个文件、201/201；
- 合同专项检查器：新增 RED 后最终 20/20；专项矩阵 write/check 为 `matched`；
- API 全量：271 套通过、19 套条件跳过，5379 项通过、51 项跳过；
- Web 全量：154 个文件、1566/1566；
- API/Web typecheck 与 lint：通过；
- Web `check:ui` 与 production build：通过；
- API production build：通过；
- API 业务英文错误检查：扫描 400 个生产 TypeScript 文件，54 处允许的内部英文哨兵；
- Prisma validate：使用不监听的本机虚拟 URL 通过，未建立数据库连接；Schema 未修改；
- 六份生成清单普通 write/check：一致；本轮不运行 `--require-ready`，因为全站存量 blocker 仍在；
- `git diff --check`：通过；
- Web production build 仅保留既有大 chunk 告警；API 全量仅保留既有 Fontconfig 本机缓存告警
  与测试故障注入日志。

## 独立复核与剩余证据

独立前端复核曾发现一个 P1：POST 只携带 `billId`，而项目岗位守卫此前不会从持久化清单解析
真实项目，合法项目岗位可能被误拒，同时伪造 query/body `projectId` 可能把授权判断引向错误项目。
新增 RED 精确证明合法 A 项目岗位失败、仅有 B 项目岗位者伪造 B 坐标越权、未知清单没有资源级
失败关闭；最小修复让 `billId -> ContractBill -> ContractVersion -> Contract.projectId` 优先于任何
客户端坐标，断链统一拒绝。Guard + controller 60/60、目标 API 12 套 373/373、API typecheck、
lint、build 和全量回归通过，独立复核确认原 P1 已闭合且无新增 P0/P1/P2。前端 nullable facts、
POST 后刷新失败锁、localStorage capability 剥离、Excel/恢复副本治理行完整性问题也均已在终审前
闭合。

仍保留两项非阻断运行级证据：

1. 本动作尚未在真实 PostgreSQL 上证明双请求单赢家及 Audit 中段故障全事务回滚；
2. 尚未启动本机 preview 覆盖 Chromium/WebKit 与移动响应式关键路径。

本切片没有获得 Docker/PostgreSQL 或 preview 的独立授权；此前针对零采 runner 的授权不延伸到
合同清单余量取消，因此未把 mock/单元事务证据伪装成真实数据库或浏览器证据。另有批量 lineage
解析为 O(rows × lines/edges) 的非阻断 P2 性能观察项，最终 100/500/1000 行预算门禁仍须复核。
上述证据应在 Task 11/最终发布门禁中补齐；未补齐前不构成精确发布候选。

## 下一步

本切片可提交聚焦 conventional commit。Task 11 下一条按既定顺序进入项目垫资额度 F0/F1/F2/F3
动作；这些动作及后续 Task 12–15、全量迁移/浏览器/备份恢复发布门禁完成前，不得把本切片外推
为实施包 5 或五包发布候选完成。
