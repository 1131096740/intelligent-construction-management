# #113 当前项目填写入口缺口矩阵

本次盘点基线为 `a0c892bdabb949fe85bf4d562d7004581a599e18`。本文件是实现范围和缺口记录，不是整票完成或上线证据。2026-09-17 重新读取 #113 body/comments，适用最新 Owner claim `5707875723`、本人资料精简决定 `5707792451`，及已批准产品蓝图、派生验收矩阵和权威更正。公司/组织七项关闭入口及五模板隔离保持，不能用旧验收恢复生产 consumer。

| 活动填写入口 | 现有用户链与领域权威 | 统一接线现状 | 剩余工作及边界 |
| --- | --- | --- | --- |
| 项目创建：编号、名称 | `ProjectOperatingOverviewPage.vue` → fresh create-capability → 专属 create-validation → 原 `POST /projects`；原董事长/总经理 guard 不变 | 已获批准并实现 `project_create` 定义与统一表单；纯预检复用原字段 normalization、检查当前 definitionVersion，不创建 target/租约/token；原 POST 生成真实 Project.id 后在同事务按正式 project target 冻结 revision 1 | 本地 HTTP/PG16、桌面/390 路径通过；旧调用省略版本仍由服务端当前定义冻结。整票集成与最终固定 SHA 门禁未完成 |
| 项目重命名：名称 | 同页面 → fresh update-capability → `PATCH /projects/:projectId`；原事务更新并审计 | 第二片已接 `project_rename` 单名称定义、统一表单和 fresh validate，再沿原 capability/PATCH 写入 | 原董事长/总经理 global + 当前项目岗位范围不变，技术管理员及异项目岗位不能借用；当前项目桌面/手机用户链通过，未声明项目切换交互覆盖或冻结写链完成 |
| 经营档案：经营账生效日、接管完成日、接管状态 | `ProjectOperatingProfilePanel.vue` → `PATCH /projects/:projectId/operating-profile`；`ProjectOperatingProfileService.updateProfileInTransaction` 原事务校验、更新、审计 | 首片已接入共享表单、fresh 三字段定义和 validate；专属 resolver 复用原领域权限入口，项目 scope/target 严格匹配 | 本地真实 HTTP/PG16 与桌面/手机浏览器已验证失败保留输入且零 PATCH、成功原领域写入；未新增冻结写链，不能据此声明整票快照冻结或全门通过。其余入口仍按下列缺口推进 |
| 唯一施工企业：候选版本、生效日、变更原因 | 同 panel → options → `POST /projects/:projectId/construction-enterprise`；原 `ProjectService.assignAffiliate` 处理版本、锁定及原审计 | 第三片已接 `project_construction_enterprise` 定义、统一表单、fresh validate，候选仍来自原 options | HTTP 和桌面/手机用户链通过；原事务继续裁决当前候选、锁定、生效期和审计，不把字段预检当业务状态最终授权。未扩权或新增冻结写链 |
| 新增参与公司：公司、生效日、加入原因 | 同 panel → options → `POST /projects/:projectId/participating-companies`；原领域事务维护版本与有效区间 | 第四片已接 `project_participating_company_add` 定义、统一表单和 fresh validate；候选仍来自原 options | HTTP 与桌面/手机用户链通过，原项目财务权限、重复加入拒绝、#284 时间及连续覆盖事务规则不变；未新增冻结写链 |
| 停止参与：停止日、原因 | 同 panel 确认弹窗 → fresh profile definition → 专属 validate → 原 `PATCH /projects/:projectId/participating-companies/:participantId/deactivation` | 已实现 `project_participating_company_deactivate` 定义及统一表单；target 为真实 participantId，原事务锁行推导 project/company/version 后冻结 revision 1，保留原权限、锁序、领域停止规则及审计 | 公开 profile 回读持久快照，错岗/跨项目/伪归属/stale/二次停止与审计故障回滚已验证；技术坐标不在 Web 展示。整票集成门禁未完成 |
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

以上为前四片交付时的历史记录；项目创建与停止参与后续授权及当前实现见下节。整票冻结策略与完整门禁仍待集成；未推送、未执行 CI 或生产操作。

## 第五、六片：项目创建与停止参与（2026-09-17 本地 checkpoint）

实现父基线为 `fd2ce6bc845d9354fe62477eb14ecec88f0d3e92`。用户已明确批准同事务校验和快照接线；本片没有新增权限、Schema、迁移、通用 target 或短期创建凭据。`CreateProjectDto` 原为 interface，创建预检提取复用原 `ProjectService` 的 `requiredTrimmed` normalization，不伪称有运行时 DTO 字段装饰器，不使用 `view` 代替创建校验。停止 DTO 沿用原日期/非空文字校验，仅增加可选 definitionVersion。

- 项目创建：capability.definition 缺失的公开 RED → GREEN；POST 原事务先创建真实项目，再 registry freeze、快照持久化、freeze 审计及原 project.create 审计。预检零项目/快照/审计；空 code/name、过时定义、技术管理员和财务岗位均拒绝；本用例唯一标识的快照持久化故障令三者全零，清理后同一请求成功。
- 停止参与：profile.definition 缺失及持久快照回读 RED → GREEN；原 Project→participant 锁序、原财务岗位/本人关系判定、覆盖/经营事实限制保持。错岗位、跨项目、客户端伪 project/company/version、过时定义、二次停止均拒绝。原停止审计的唯一合成故障令关系状态与快照原子回滚，清理后成功。DB 仅用于合成账号/岗位 bootstrap、系统边界故障注入与零残留断言；业务提交和历史回读通过公开 HTTP。
- Web：新建项目与停止参与共用服务端字段表单，先刷新 capability/profile 及定义并预检，再调用原写 API；失败保留输入。桌面/手机使用各自独立项目/参与关系。实际日期控件提交 `YYYY-MM-DD`；日期诊断确认旧隐藏面板被广域 selector 命中，改为可见面板后通过，未绕过日期控件。失败 trace 仅保留在本机临时目录，未提交。
- 最新本机门：一次性 PostgreSQL 16 HTTP **23/23**；真实 Desktop Chrome / iPhone 13 WebKit（390）**17 passed / 1 skipped**（既有手机重复撤权用例跳过）；项目域 API **35 suites / 803 tests**；Web 项目相关 **19 files / 173 tests**；API/Web/E2E typecheck、触及文件 lint（0 warnings）、check:ui、diff check 通过。既有全 Web lint 0 errors，历史其他页面 warnings 未改。
- 各次一次性容器均仅清理自身；最新综合浏览器门容器 `jiangkong-pol113-http-5e09f1ef-2b92-426e-80a7-cc54645f65e1`，随后 HTTP 补充错岗/故障清理断言的容器 `jiangkong-pol113-http-4cc4c16e-f380-46d5-aee4-d11e01aea3a8` 均已删除。此前浏览器沙箱启动错误、日期 locator RED 和过时定义 500 RED 不算成功证据。

剩余整票边界：本文件仅证明独立候选的第五、六片，未宣称 #113 整票完成；还需总控与 #114 冻结实现串行整合、其他四个项目入口的同事务快照策略、完整派生验收/manifest、固定 SHA 全量 release/双审/CI 及 GitHub 交付。本片不修改根 PROGRESS，不 push/PR/部署/生产操作；最终 checkpoint SHA 由外部回执绑定，文内不自指。

## 独立双审修复：历史投影与正式场景来源

父 checkpoint 为 `25cae258d7ccb1affb1c8ffb8346463b79797e31`；本次新增提交，不改写旧提交。

- Standards M：新增 `entrySnapshots` 从持久化对象直出改为最小业务历史投影，仅返回中文场景名称、revision、definitionVersion、frozenAt、允许的字符串业务值；停止参与补查询得到的中文公司名。不返回 entityId/entityType/snapshotId、原始 definitionSnapshot/valuesSnapshot。原 profile 顶层 projectId、participatingCompanies.id 等既有领域 API 契约保持。公开 HTTP 负向断言确认新增历史响应不含本项目/参与关系 UUID 或原始快照字段。
- Spec M：两份定义原样迁入正式 `BUSINESS_ENTRY_SCENE_DEFINITIONS` 单一来源，项目适配从正式 registry 读取定义并 validate/freeze；移除私有 registry。正式 access/domain-authorization 清单登记创建与停止参与。创建既有项目 target 沿董事长/总经理 effective role policy；预创建仍仅原领域 capability/无目标预检。停止参与显式查询 participant→project 归属，再由原项目财务权限 helper 授权。错误类型/目标及错岗位 fail closed。两项通用 freeze 明确拒绝，只有原领域提交事务能够冻结，避免通用 snapshot store 绕过领域事实。
- RED：正式 scene contract 1/4 缺定义；真实 HTTP 22/23 因历史泄露 UUID；通用 freeze 拒绝测试曾返回旧 store 的 409 而非领域入口拒绝。GREEN：scene/access/authorization 19/19、相关 API 47 suites / 891、HTTP/PG16 23/23、Web 页面 19 files / 173；API/Web/E2E 类型、触及 lint、check:ui 与 diff 检查通过。
- 未修改 Web 控件或用户流程，仅更新 E2E 历史响应断言；按本次授权不重跑完整 browser，不将父 checkpoint 的浏览器结果伪称为新 SHA 全量浏览器证据。重复 load helper 的 LOW 仅记录，本次未抽取，避免扩大界面 diff。
- 未改 Schema、migration、transaction registry、根 PROGRESS 或他人候选；共享 scene-registry 的合入由总控与 #114/#115 串行协调。未 push、PR 或生产操作，仍待新 SHA 独立双审。
