# #113 当前项目填写入口缺口矩阵

本次盘点基线为 `a0c892bdabb949fe85bf4d562d7004581a599e18`。本文件是实现范围和缺口记录，不是整票完成或上线证据。2026-09-17 重新读取 #113 body/comments，适用最新 Owner claim `5707875723`、本人资料精简决定 `5707792451`，及已批准产品蓝图、派生验收矩阵和权威更正。公司/组织七项关闭入口及五模板隔离保持，不能用旧验收恢复生产 consumer。

| 活动填写入口 | 现有用户链与领域权威 | 统一接线现状 | 剩余工作及边界 |
| --- | --- | --- | --- |
| 项目创建：编号、名称 | `ProjectOperatingOverviewPage.vue` → fresh create-capability → `POST /projects`；controller 限董事长/总经理，原服务事务创建并审计 | 有领域 capability，没有该动作的场景定义/统一预检；原 guard 无项目上下文时合并任意项目岗位，不能直接换成只查全局岗位的 legacy global 场景 | 等待用户确认兼容模式：原 capability 附定义及短期创建目标、同原 guard 的只读领域预检、原 POST 不变。不得擅自 global-only 缩权，不拿经营档案 target 冒充新建目标 |
| 项目重命名：名称 | 同页面 → fresh update-capability → `PATCH /projects/:projectId`；原事务更新并审计 | 第二片已接 `project_rename` 单名称定义、统一表单和 fresh validate，再沿原 capability/PATCH 写入 | 原董事长/总经理 global + 当前项目岗位范围不变，技术管理员及异项目岗位不能借用；当前项目桌面/手机用户链通过，未声明项目切换交互覆盖或冻结写链完成 |
| 经营档案：经营账生效日、接管完成日、接管状态 | `ProjectOperatingProfilePanel.vue` → `PATCH /projects/:projectId/operating-profile`；`ProjectOperatingProfileService.updateProfileInTransaction` 原事务校验、更新、审计 | 首片已接入共享表单、fresh 三字段定义和 validate；专属 resolver 复用原领域权限入口，项目 scope/target 严格匹配 | 本地真实 HTTP/PG16 与桌面/手机浏览器已验证失败保留输入且零 PATCH、成功原领域写入；未新增冻结写链，不能据此声明整票快照冻结或全门通过。其余入口仍按下列缺口推进 |
| 唯一施工企业：候选版本、生效日、变更原因 | 同 panel → options → `POST /projects/:projectId/construction-enterprise`；原 `ProjectService.assignAffiliate` 处理版本、锁定及原审计 | 第三片已接 `project_construction_enterprise` 定义、统一表单、fresh validate，候选仍来自原 options | HTTP 和桌面/手机用户链通过；原事务继续裁决当前候选、锁定、生效期和审计，不把字段预检当业务状态最终授权。未扩权或新增冻结写链 |
| 新增参与公司：公司、生效日、加入原因 | 同 panel → options → `POST /projects/:projectId/participating-companies`；原领域事务维护版本与有效区间 | 第四片已接 `project_participating_company_add` 定义、统一表单和 fresh validate；候选仍来自原 options | HTTP 与桌面/手机用户链通过，原项目财务权限、重复加入拒绝、#284 时间及连续覆盖事务规则不变；未新增冻结写链 |
| 停止参与：停止日、原因 | 同 panel 的确认弹窗 → `PATCH /projects/:projectId/participating-companies/:participantId/deactivation` | 无独立统一场景定义/校验接线 | 需明确原参与关系 target/项目归属解析；保留领域停止规则，不能仅按项目 ID 代替参与关系身份 |
| 删除无正式事实的参与关系 | 同 panel 的专用确认 → `DELETE /projects/:projectId/participating-companies/:participantId` | 非字段录入动作；既有领域守卫 | 保留原条件及确认交互，作为邻接回归，不造新字段表单 |

## 首片接缝与共享接线依据

- 公开接缝：真实 HTTP definition GET / validate → 原 operating-profile PATCH → 原 operating-profile GET；Web 从同三字段定义呈现桌面/窄屏表单，并在 fresh validate 失败时保留用户输入且不发 PATCH。
- 首片 RED 证据：原 `project_operating_profile` 注册 `legacyUnresolved`，公开 validate 返回 400；协调分配该专属 hunk 后复用原领域授权，新增项目测试转 GREEN。定义 GET 本身不等价于写入授权。
- 原领域权限：`ProjectOperatingProfileService.isProjectFinanceManager` 检查用户 active，仅合并指定 projectId 的 UserPosition 和 ProjectMember，只接受 `finance_staff` / `finance_director`；全局财务、其他项目财务或 super_admin 不因技术身份取得权限。
- 复用路径：`BusinessEntryDefinitionModule` 已 imports `ProjectModule`，后者已 exports `ProjectOperatingProfileService`。由共享 hunk owner 注入该服务、调用其窄公共权限入口即可复用原判定，不需新增模块依赖或权限语义。新公共入口必须仍调用原私有判定并确认目标项目有效，不复制另一套角色算法。
- 最终业务写入仍在原 `updateProfileInTransaction` 复核权限并执行原数据库约束；预检不代替事务授权，不改变 Schema 或日期/状态规则。

## 当前证明范围

基线仍为 `a0c892bdabb949fe85bf4d562d7004581a599e18`，以下证明绑定本地未提交首片差异，不是该 SHA 的清洁树收据：

- 本候选一次性本机 PostgreSQL 16.15 / 真实 AppModule HTTP：15/15；新增项目财务权限、跨项目/全局财务拒绝、无效输入零业务变更及原领域成功写入覆盖。
- 真实浏览器：Desktop Chrome 与 iPhone 13 / WebKit 共 2/2；先证明旧页面缺少统一表单的 RED，再验证预检失败保留输入且不发 PATCH、成功写入及窄屏无表单横向溢出。
- API 窄回归 4 suites / 46 tests；Web 项目结构回归 2 files / 37 tests；API typecheck/lint、Web typecheck、E2E typecheck、UI rules 和 diff check 均通过。Web lint 无错误、510 条警告；同一 ESLint 实例对本片唯一修改的 Web src 文件分别 lint 基线原文和当前文件，均为 0 errors / 0 warnings，因此本片没有新增 Web lint 警告；其余警告未作业务审查。
- 未运行整票全门、发布门或 CI；未 commit/push、未变更生产。此前 14/14 仅覆盖本人资料与合作单位，不替代本次项目证明或其他活动入口验收。

运行器 `services/api/prisma/run-pol113-http-local.cjs` 保留，仅使用随机凭据、loopback、一次性 pol113 数据库及合成数据，并清理自身容器。本文件不关闭 #113 或任何混合派生票。

## 第二片：当前项目重命名

首片已由主控保存为本地检查点 `54f5e6fa3a6893e31f8d57daaf2f30770513335f`。以下结果属于其后的未提交第二片差异，不是该检查点的清洁树收据：

- 先公开 HTTP RED：未登记场景返回 404；接线后真实 HTTP/PG16 16/16。原 `requiredTrimmed` 与通用 required text 都拒绝空白名称，无须扩大共享校验器；最终 PATCH 仍执行原 trim、更新和审计。
- 领域窄入口复用 `ProjectVisibilityService.effectiveRoleScopes`，查询与原 `PermissionGuard` 的 global/当前项目 UserPosition、ProjectMember 一致，再按原 `chairman` / `general_manager` 裁决。未改原 controller、岗位语义或 Schema。
- 浏览器先因旧页面缺少统一名称表单 RED。后续失败诊断发现测试预设项目与页面默认项目不同，故测试明确绑定当前默认项目，仍逐一断言预检 target、PATCH URL 和公开 GET 回读一致；未修改项目切换逻辑，也不把该交互算作本片已验证范围。
- 最终真实浏览器 Desktop Chrome / iPhone 13 WebKit 共 4/4（名称和经营档案各两项）；HTTP 16/16；共享接线 API 窄回归 41/41；Web 项目结构 37/37；API typecheck/lint、Web typecheck、E2E typecheck、UI rules、diff check 通过。
- 本片两个 Web src 文件 ESLint 均 0 errors / 0 warnings，新增表单的四条格式警告已修复。未执行整票全门、CI、push 或生产操作。

剩余范围为项目创建、施工企业绑定、参与主体新增/停止及整票派生验收与冻结策略核对；不能以本片替代这些入口。

## 第三片：施工企业绑定

第二片已由主控保存为 `0bd5914970af1bcd343b4dd575d9487316b3a8ee`。第三片为此后的本地差异：

- HTTP 场景未登记 404 RED → 17/17 GREEN；公开合作单位创建生成合成版本，原 options 读取，原施工企业 POST 写入并由经营档案 GET 回读；项目财务允许、全局财务/董事长拒绝，空白原因预检失败且经营档案仍无绑定。
- 浏览器旧表单缺统一 region RED → 桌面 Chrome / 手机 WebKit 6/6 GREEN（包含档案、名称回归）。日期测试按 TDesign 默认只读输入规则真实点击日历，不绕过控件；验证空白原因保留、零 POST、成功原写入、版本/日期回读及表单无横向溢出。
- 共享接线窄回归 41/41、原领域窄回归 22/22、Web 结构 37/37；API typecheck/lint、Web typecheck/E2E typecheck、修改页面 ESLint 0 errors / 0 warnings、UI rules 和 diff check 通过。
- 原 controller、领域事务、Schema 均未改。最终状态约束仍在 `assignAffiliate` 内，字段预检不能替代锁定/版本/日期约束。运行器最终自身容器已清理。

当前仍未完成：项目创建（兼容权限模式待确认）、参与主体新增/停止、整票冻结策略与全门；未推送、未执行 CI 或生产操作。

## 第四片：新增参与公司

第三片已由主控保存为 `1bc246c1b9e142e9304d1f6690cf57672a97c58f`。本片证据绑定该 SHA 之后的本地差异，不是清洁树收据：

- 场景未登记 HTTP 404 RED → 18/18 GREEN；合成完整公司经原公开公司创建接口生成，原 options 读取；统一预检成功后沿原新增参与公司 POST 保存并回读，空白原因无新增，原事务仍拒绝重复加入。
- 浏览器旧表单缺统一 region RED → Desktop Chrome / iPhone 13 WebKit 共 8/8 GREEN（含此前三片回归）。验证日期控件、空白原因保留且零 POST、成功回读和表单无横向溢出；仅通过原 DELETE 清理本用例创建的无正式事实合成关系。
- API 窄回归 5 suites / 57 tests；Web 结构 2 files / 43 tests；API typecheck/lint、Web typecheck/E2E typecheck、UI rules 和 diff check 通过。修改页面 ESLint 0 errors / 0 warnings。最终真实 HTTP 运行器退出 0，且独立查询确认自身容器 `jiangkong-pol113-http-9ce5ed59-b94f-4e70-aab5-594a94bd2d12` 已不存在。
- 未改 controller、领域事务或 Schema。停止操作需要真实参与关系身份；legacy project target 强制实体 ID 等于项目 ID，不能冒充参与关系。目前仅向主控提出原已授权档案回读附定义、原停止 PATCH 校验的领域接线方案，尚未修改共享 target 契约。

剩余为项目创建兼容方案待用户决定、停止参与关系目标接线待协调、整票冻结策略与完整门禁；未推送、未执行 CI 或生产操作。
