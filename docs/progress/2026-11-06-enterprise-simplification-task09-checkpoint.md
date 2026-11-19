# 任务09私有检查点（未整合）

私有分支 `codex/enterprise-task09-contract-form-20261106` 从正式中央 `4bdc84ff09aeec9c4d3c9da5417a855b22cbff9f` 起步。本收据记录源码与合成依赖边界，不宣称全票完成或发布资格。未读取或吸收原 dirty 根业务，未互合任务11私有候选。

新建入口真实调用 ContractService.createDraft；project+五种 businessType 可起草，inside/outside/upward 独立保存，真实初始化 Contract/ContractVersion/Bill/PaymentTerms，签约主体明确待补充，无虚构模板或已知零金额。双方可搜索现有单位或当前单手填；不创建共用单位。基础资料保存允许不完整，文书生成前另校验项目、名称、关系、甲乙方五项；新 pending 未保存手选模板时后台 queue 也拒绝。

金额 v2 四位与 NULL/0 贯通手工包干、框架未知、含税/不含税清单及 Excel；税率待补不按零推定。仅合法 draft 可在显式切口径后重新核算当前输入，界面提示不自动换算单价。跨口径旧删除恢复凭服务器冻结的删除前口径证明拒绝，保留同口径 legacy6/NULL0 原事实。旧 v1 算法、正式提交编号/付款 cents/已确认金额未扩展。

## 当前验证

- API 8 套 637/637；最新 Excel 73/73。真实公开 Nest HTTP 接 JWT、PermissionGuard 和 RetiredWriteEntryGuard；数据库边界为 synthetic，不是 PostgreSQL。
- 新建桌面及 touch390×844：10/10，含15种类型关系组合、单位搜索、真实新建→首次 GET→lease→输入保存→服务重读；真实 /submission 对新 v2 返回409，正式状态/编号未变。原06删除恢复公开回归10/10；先前基础资料/净价/包干等8/8留存。
- Web 合同54文件：653通过、1失败。失败为 `contract-workbench-canvas.structure.test.ts:187` 期待旧文案“确认后由右上角统一保存合同草稿”；准确基线4bdc的 FocusEditor 已仅有“清单修改由顶部统一保存”，本任务保留断言及失败，最终44前须处理。推荐自动选择及排除 party_a 两条相反断言按冻结 CON09/CON05 精确退役，改由真实 UI 验证，未削其它约束。
- 两端类型/lint，E2E 类型，UI规则，fresh API build 通过。原369静态编排369/369通过；第一次298/2失败日志保留，只同步新增1 prepared case的精确库存计数。
- 199迁移源码；525条动态库存（CI524+manual1）仅静态准备，manifestValid=true，executed=false。新增 ContractVersion 同行 CHECK 只为 numeric2、未提交、未生效、draft/abandoned 且 affiliate四列NULL的 pending 主体，原两支不变。新增实际PG用例源码经类型检查，未导入或执行该数据库测试。

## 尚未证明与后续

正式11未双轴/中央整合，故新建→正式 WordTemplate手选→保存→真实 DOCX/PDF生成全链待正式11整合后验证；当前合成表单服务器文书输出是明确拒绝夹具，不能计为文件证明。净价新v2文书旧renderer会误标，queue已在写前中文拒绝，待任务10接入正文/导出。新v2正式提交仍 failclosed，由任务12冻结分类/金额/主体接入；签署归档与历史接管属12/34，不声称 CON02/03全生命周期已交付。CON23保留首次正式提交自动编号，草稿编号可空且不显示DBID。

手机早期 formal-file 500 为合成夹具漏注册正式只读服务，已修夹具；父页仅 pending 阶段不挂载旧正式授权/签署治理组件，符合09/12分界。并未将此500认定生产故障，也未以多变量修正声称性能单因果。

未提交远端、未推送、未合入中央、未关票、未触发CI；无PG/SQL执行、Docker资源、短信/银行/对象存储业务操作、部署或生产写。安全检查点后仍须合最新正式中央、验证11组合、独立双轴及 exact-SHA clean source packet。

## 日志字节

- `/private/tmp/jg-task09-api-related-5.log` SHA-256 `4efca8daf61fe734cd740d8eeb7dac275cad83b50879c2620b04c35f7eeacf0d`
- `/private/tmp/jg-task09-excel-final-4.log` SHA-256 `cf961cb98f5eaf1119351dea571e220e4530c14bce0785b936f35ce5956e2da4`
- `/private/tmp/jg-task09-web-contracts-4.log` SHA-256 `c27ed5b740dce8302989ac50214089d88c912cec31f878d10fefbad99f9af0b0`
- `/private/tmp/jg-task09-new-chain-2.log` SHA-256 `ceb5609ec70a4b26679755afd7414d48b50d4d66c8a21e90ce12c6f53a68e9bf`
- `/private/tmp/jg-task09-undo-regression.log` SHA-256 `f8eafa208e23a030f885f27944dc9c6d5e4762f16dd6a817ef35c8b0cf6776ed`
- `/private/tmp/jg-task09-new-preflight-green.log` SHA-256 `76211f679a0b78608c38411816183d0a6c29ec85d9d4cc763c88c0c74d2c70c5`
- `/private/tmp/jg-task09-static369-2.log` SHA-256 `30380c81c167b220c0f00b737c2ea9cf0196b9cf571c452a0932a5b92c9251d7`
- `/private/tmp/jg-task09-pg-inventory-3.log` SHA-256 `5fcd8589f95de7184fa5ecad61d8ffaa5f958f592af5ab993d027da1692d9521`
- `/private/tmp/jg-task09-api-types-8.log` SHA-256 `a757ca5925f3ae18bba341e321fa8a89da94e6daaa1efa358d42f0505f98b7c3`
- `/private/tmp/jg-task09-api-lint-3.log` SHA-256 `46642744d45e082a48c782aea3a9f7288bb41639dec537fa0374fae6f894b28a`
- `/private/tmp/jg-task09-api-build-2.log` SHA-256 `23682f0a6a93a0967e9c947ce092b042633e9af0599b7d0bc5fff51fa9378388`
- `/private/tmp/jg-task09-web-types-7.log` SHA-256 `344fd9116e3818066b198c8440fecae5b5f34b5b21429ac04c32bbd8046e530f`
- `/private/tmp/jg-task09-e2e-types-2.log` SHA-256 `d21956042676b00d55515faaedd600bfab57d2cda7eb6070139ac7f81bffa62c`
- `/private/tmp/jg-task09-web-lint-2.log` SHA-256 `2d36075c9a90747a16e45758316ad288b5aeff8ebc4a18ecd459a48c6e2a4925`
- `/private/tmp/jg-task09-checkui-3.log` SHA-256 `f90a9397704defe729ad24602e0404199214644cfc0ab44d0b316f9eb03cfbf4`

治理补充：source检索两推荐wrapper除定义外仅api.test真调用；模板usage-preview另有反向字串断言。`/private/tmp/jg-task09-retired-source-consumers.log` 保存实际检索，wrapper登记仅+2 test_only；任务11正式整合时须保留其独立-9恢复生产增量。routeUsage两GET已按批准精确登记，见下方最终增量；原blocked日志保留。

基线旧文案字节证明：`git show 4bdc84ff09aeec9c4d3c9da5417a855b22cbff9f:apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue` 写入自有临时证据 `/private/tmp/jg-task09-baseline-focus-editor.txt`，SHA-256 `8f90eb5e8e907927967eb2653481699fa93c76973630c6a78b9f2ee2901e7279`；第1134行仅“清单修改由顶部统一保存”，原canvas第187行所需文案不存在。

治理最终增量：两GET已精确登记exit_candidate只读候选，无API删除或权限变化；实际none110/web_wrapper550/derived479/page497/exit99/override224及hash同步，生成链ready703路由/397动作/0阻塞，原blocked日志保留。usage-preview旧创建it绑定已撤销的强制businessTemplate/bootstrap预选/推荐drawer，按CON09和新v2create批准退役；前两条模板库只读预览完整保留2/2通过，原2pass/1fail保留。

正式11类型桥接：11冻结当前正式06 parent类型资格；正式11合中央后由09接手basics.businessType到模板资格/selector及同PUT type+layout最窄增量，再实际验证新建手选和文件。当前helper接口已准备，但组合未证明，不称CON09全完成。

最终原write/check链全部通过：fresh703路由、657wrapper/696绑定、397动作/0阻塞、86旧写410与13旧只读、contractMutation80/22。原检查器/预算未弱化。全部101条成功/失败日志字节库存 `/private/tmp/jg-task09-evidence-log-inventory.json` SHA-256 `7cd9454a633940d571d85b99a805f063c9a5cc5b52b6ce99657dc9d9f94ee95c`。
