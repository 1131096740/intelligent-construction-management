# 05 人员岗位、自审与职责委托：本地阶段收据

本票为 #387。首候选 `b87be098730ecbf610d142541e72c4371c2c27bb` 保留首审历史；准确补修候选 `c37e0a7dac213e27420f32ee24f4edaf1fc35512` 已经独立[Standards](2026-11-05-enterprise-simplification-task05-standards.md)/[Spec](2026-11-05-enterprise-simplification-task05-spec.md)复核均0项。中央合并 `6d7bd40a8f7a2f54d845320bf6c664d6dc3c7023` 完整树与候选相同。本地确认边界已整合，#387仍OPEN待父控封包、推送及收票；没有迁移、真实PG资源、部署或生产写授权。

## 中央准确合并验证

Node `v20.20.2`、pnpm `9.15.9`；以下检查均在准确合并SHA `6d7bd40a8f7a2f54d845320bf6c664d6dc3c7023` 执行，之后本提交仅变更状态/收据MD，不把后续文档提交冒称为完整产品验收：

- API23套1129项、Web11套110项全部通过；两包typecheck/lint、Web `check:ui`、API build退出0。API测试显式移除全局 `SKIP_DATABASE_CONNECT`，不进入合同示例数据分支。Web lint保留759 warnings、0 errors。
- 原严格路线/包装器/动作/用途/能力矩阵check/ready链全部退出0：702路由、656 wrappers/695绑定、396动作、0阻塞。原4套治理unit整次210/210通过，包括本次准确仓库基线golden，不以作者209+定向1拼成中央整次结果。
- 原静态CI编排整次369/369通过；原库存validator明确 `executed:false`，23组78文件521逻辑场景（CI22组77文件520，人工1组1文件1）。只检查迁移基线源码198份，未执行迁移或PG。
- 中央日志：`/private/tmp/jg-enterprise-task05-integrated-api.log`、`...-web.log`、`...-governance-unit.log`、`...-ci-orchestration.log`，包检查及治理逐命令日志/哈希记录于 `...-api-package.json`、`...-web-package.json`、`...-governance.json`、`...-governance-unit.json`；最终合并JSON收据由父控交接保存。
- 受影响公开服务/合成HTTP不是实际PG竞争或真实网关验收；首审、旧497计数、旧CI516及其他失败日志仍保留。753旧代理deadline失败亦未被此次369通过解释为因果修复。

## 补修与公开行为

| 需求/首审项 | 业务权威与公开验证 |
|---|---|
| IAM02/03 普通项目岗位不能因同项目读取他人敏感单据 | `sensitive-business-read.ts` 按领域明确岗位，未复用合同全貌岗位集合。财务员、财务/综合主管及本项目经理按职责读取结算/付款；合同主管结算本职可读，付款须实际参与；物资/预算/工程等普通岗位无实际参与不获财务全貌。公开列表、详情、分页、导出与相关私有附件保持同一范围。公司级岗位作用于所有有权在用项目，项目级岗位不扩展他项目。 |
| 合同公开读范围 | 无实际参与的普通物资/预算/工程岗位只保留七字段公开摘要，敏感详情拒绝。真实创建、提交、签批参与可读本人相关原单；合法当前冻结待审职责/受托人在签批前可读取原单。合同员本职、明确公司合同/财务/综合岗位、本项目经理及原技术管理员合同读权限保留；物资主管只按材料/设备合同本职或参与读取。详情中结算、付款子记录也受各自领域读权限约束；资料范围不完整时隐藏汇总余额并明确说明，不把筛选后的零额冒充全量余额。未触06网格或金额/状态算法。 |
| 新无范围 standing 委托被拒绝 | 新建三项范围全部省略也在持久写入前拒绝。历史 standing/scoped 记录与旧消费者保留，有限 clearing scope 的既有接口合同保留；新并联职责委托仅支持零采 `protocolVersion=1` / `executionMode=parallel`，不冒充全域迁入。 |
| APR12 有限职责、竞办与当前能力 | 新建仅选择当前轮未办职责、启用接收人与期限；原人与受托人办理共用实例/职责锁，记录实际签名人与委托归因。只读能力 GET 复用同职责鉴权，UI写入前重读并失败关闭；快照不授权写入，POST/DELETE仍事务内重验。失岗/已办/已撤销的公开服务与UI负控均保留。 |
| IAM01 固定流程、当前人员与缺岗 | `/approval-rule-assignments` 按当前调用者可见项目与有效公司/项目岗位，只返回当前人员id/姓名及缺岗，不返回手机号、密码。系统配置只读展示当前人员/待配置；零采明确当前版本并联、两职责同时待办，其他流程如实标“现行冻结流程”，不允许增删或重排节点。 |
| 重复撤销列 | 操作列只在权威列配置声明一次；公开客户端渲染测试实际消费列、记录与slot，确认一个撤销入口、一次DELETE；能力撤回时不DELETE且保留记录。 |
| APR04 创建/提交人自审 | 零采并联每职责独立原因+本人密码验证；资金执行复用可靠created/submitted字段；合同原创建A转交B提交后A审批仍需本人确认。合同创建来源仅从明确创建审计解析，新提交服务器冻结；无来源/多义拒绝相关提交/审批写，保留旧读取与签名。密码不写审计。历史真实来源核对/受控迁入仍是42硬门。 |
| IAM05/13 管理员读批分离 | 技术管理员保留审计与原合同读，不自动成为业务审批人或取得财务附件读权；叠加显式有效业务岗位按该岗位规则。停用/失岗的当前鉴权与历史事实保留不变。 |

## 本地验证

- 受影响 API 23组 **1129 passed**，覆盖真实公共服务、loopback HTTP、合成数据库边界；新当前人员HTTP含他项目拒绝/无敏感字段，合同当前合法受托人签批前读取正控。
- 受影响 Web 11组 **110 passed**；最后因果证明代码调整后，5组 **74 passed** 复核委托、固定流程和审批载荷。不是实际浏览器/真实数据库验收。
- API build/typecheck/lint、Web typecheck/lint、`check:ui` 通过；Web全包仍有759 warnings、0 errors，不宣称全站warning清零。
- 原静态CI编排 **369/369 passed**。原公开 `--validate-manifest` 返回 `executed:false`，23组78文件521逻辑场景；CI eligible为22组77文件520，人工专用任务01为1组1文件1场景。
- 治理工具原unit首次209/210通过，唯一失败为直接读取当前仓库却仍断言497路由的基线case（40b已登记698）；本票4个新增GET和2条已恢复页面写用途分别派生702路由及498页面用途，依据原生成器实际登记摘要同步该case后定向通过（其余209项未重复跑），首次失败保留。
- 原生成器派生真实Nest路由 **702**、Web wrappers **656** / **695**绑定、页面动作 **396**。移除已恢复真实委托UI的过期wrapper退休标记和POST/DELETE退出候选标记，登记真实能力GET与实际写handler，未增加工具豁免或伪造绑定；能力与动作归因均由原检查工具验证。

命令及全部日志保存在外部 `/private/tmp/task05-r2-*.log`，精确清单随交接JSON。关键原命令：

```text
pnpm --filter @jiangkong/api exec jest --runInBand <本票23组明确spec路径>
pnpm --filter @jiangkong/web-admin exec vitest run <本票11组明确测试路径>
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm test:ci-orchestration
node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest
node scripts/inspect-whole-site-capabilities.mjs --write
node scripts/inspect-whole-site-web-api-manifest.mjs --write
node scripts/inspect-whole-site-page-action-manifest.mjs --write
node scripts/inspect-whole-site-route-usage-manifest.mjs --write
node scripts/inspect-whole-site-capability-matrix.mjs --write
pnpm run inspect:whole-site-page-actions:ready
pnpm run inspect:whole-site-route-usage:ready
pnpm run inspect:whole-site-capability-matrix:ready
```

首次失败保留：普通项目岗位财务读取/无范围委托RED、重复操作列RED、静态规则无当前人员RED、普通岗位合同敏感读取RED；旧CI516小计与旧治理退休登记/构建新鲜度/因果来源失败均保留，按真实缺口修复，未跳门。

## 准备与未验

原 `spot-procurement-entry.http.pg.spec.ts` 的API PG逻辑由7增至11，新增原人/受托竞办、撤销、半开期限到期、兼两职责逐次本人确认。竞争准备断言为唯一201+另一合法403/409、单次动作、重复写不生效及双方对应待办消失。

`pol115-spot-entry` 是专用入口内部entryId，**不是CLI selector**；canonical登记组为 `pol113_pol115_business_entries`，组176→180，总517→521。逻辑登记数量不等于实际执行的Jest数量，也不表示PG通过；浏览器独立门不混入API PG计数。

未运行PG spec、SQL、`--execute`、Prisma migrate、Docker、Task01执行driver/helper、真实短信/对象存储、实际浏览器资源runner、部署或生产操作。静态校验明确按父控授权使用原validator/原unit/原CI静态编排，不启动真实资源。16/42/44硬门、真实竞态与送达、真实历史来源核对全部仍待另行验证。

07项目/单位的公开HTTP、公共服务及现有管理UI边界已确认，只使用合成数据库；真实PG仅准备。07及11公开测试边界均已确认，继续等待05由父控正式关闭后领取实施。
