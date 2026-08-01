# 实施包 5 Task 11：合同签署实质变化申报

日期：2026-08-01

## 当前结论

本切片闭合现行能力：

- `POST /contracts/:contractVersionId/signing/material-change`

合同进入用章、线下签署或待归档阶段后，如果线下文件发生金额、相对方、条款等实质变化，
冻结经办人或启用中的全局合同主管可从合同详情页申报。后端在同一事务内取消当前用章任务、
失效所有 active 正式文件、把合同版本退回 `draft`、将 `draftRevision` 精确加一并写完整审计；
旧任务、旧文件和旧审批事实只改为失效/取消状态，均不删除。退回后必须按新 revision 重新编辑、
提交审批和生成当前审批单。

本切片已经完成失败测试、最小实现、审批单新旧轮次隔离、通用文件票据防绕过、前端 fresh
preflight 与结果不明恢复，以及两套治理矩阵收口。它只闭合 Task 11 的一个独立切片，不代表
Task 11、实施包 5 或五包发布候选完成。

本轮未连接生产，未推送、合并、部署、执行生产迁移或修改生产业务数据；没有执行 retention、
transition、业务草稿 purge、正式业务记录删除、AuditLog/checkpoint 清理、旧表旧字段删除或
其他物理删除。

## RED 与最小实现

### 先行失败证据

改造前及独立审查形成的失败证据锁定了以下问题：

- 后端没有“签署实质变化”专用 DTO、状态/任务配对、权限、CAS、审计和稳定并发错误；
- 旧 active 正式文件与旧用章任务没有在退回草稿时统一失效，生命周期仍可能把历史签署件当作
  当前有效签署事实；
- 合同详情没有服务端派生 action、精确 revision/task/status 坐标或专用页面动作；
- 页面最初没有 fresh GET、route/detail/dialog/operation owner、双击单 POST、卸载隔离和 POST
  结果不明后的权威重读；
- 旧 approved 审批单可能在合同已退回草稿或进入新一轮审批后仍被详情、生成接口或通用文件
  下载票据读取；
- 审批单渲染/生成期间发生最新审批实例、合同状态或 revision 漂移时，旧 PDF 可能被归档为当前件；
- 治理清单最初把复合 executor 的 GET/POST 因果链记为未验证，并把结果不明错误类误报为
  不存在的 API wrapper；合同专项解析器也不认识既有 `governedContractPath(...)` 路径构造器。

新增测试分别先证明上述行为缺失；专项解析器新增用例先以 `1 failed` 精确复现动态路径误报，
再进入实现。

### 后端不变量

`ContractSealService.invalidateForMaterialChange()` 现在：

1. 只接受以下精确版本/任务配对：
   - `approved_pending_seal / pending_approval`
   - `in_seal / in_seal`
   - `seal_approved_pending_archive / completed`
   - `pending_archive_confirm / completed`
2. 只允许当前冻结经办人或启用中的全局 `contract_director`；
3. 在串行事务和锁内复核 `expectedRevision`、`expectedSealTaskId`、`expectedStatus`；
4. 在第一笔业务写前确认审计服务可用，随后以 CAS 取消任务、失效 active 正式文件、退回草稿并
   增加 revision；任一 CAS 丢失都让整笔事务失败；
5. 审计记录 from/to 状态与 revision、任务 ID、原因、失效文件 ID 和数量；
6. Prisma `P2034`、PostgreSQL `40001/40P01` 映射为稳定 409，不把并发冲突伪装成成功；
7. active 已签正式文件与历史 invalidated 文件分开计数，旧文件只保留历史阻断/追溯，不再让
   当前生命周期停留在签署或归档阶段。

### 审批单与私有文件边界

重新审批后的“当前审批单”统一按最新审批实例和当前合同状态失败关闭：

- 详情读模型、审批单生成/下载和文件 ACL 只接受最新实例为 `approved`，且合同处于审批通过后、
  用章/归档/生效/作废等允许保留审批单的状态；`draft`、`in_approval`、退回和拒绝状态不开放；
- PDF 生成 claim 绑定审批实例、实例更新时间、合同状态、revision 和版本更新时间；最终归档事务
  对合同版本加共享锁并复核 token，漂移时不创建 `PdfDocument`；
- 动态渲染前后都复核 token，并要求现有 `PdfDocument.approvalInstanceId` 精确等于当前最新实例；
- 专用下载端点把真实 `FileService` 归档锚点接入渲染链：非空 `approvalInstanceId` 必须存在
  `completed` generation claim，file/PdfDocument 三坐标和存储 SHA 必须精确；零采现行模板与上线前
  legacy 模板继续兼容且均返回动态水印件；
- 通用 `/files/:fileId/download-ticket` 不能绕过合同或零采专用审批单门禁，即使请求人是合同
  owner、旧轮次申请人、审批人或零采申请人也不例外；claim 上传/失败中间文件同样失败关闭。
  回归覆盖退回草稿、新审批进行中、新审批已通过但旧 fileId 仍绑定旧实例、零采现行/legacy
  原件、claim 缺失/未完成/file 漂移/PdfDocument 漂移；历史项目支出 `approval_form` 专用票据与
  `settlement_approval_latest` 既有链未被误封。

### Web 动作

合同详情页只在服务端唯一启用 `report_signing_material_change` 时显示专用危险动作。页面先捕获
route、合同、版本、revision、用章任务和状态 owner，再执行 fresh `GET /contracts/:contractId`；
只有服务端 action 和全部坐标仍完全一致时才执行一次 POST。提交期禁止重复提交，route/dialog/
submission token 防止 A→B 路由切换、关闭和卸载后的迟到回调污染新页面。

普通 4xx/409 保留服务端业务错误；网络中断或响应结构无法确认时进入 `result_unknown`，页面立即
重读详情：若权威 revision 已增加一且实质变化 context 消失则确认成功，否则明确提示人工核对，
不得直接重复提交。页面没有直接 `fetch`，所有请求均位于 API 层。

## 治理矩阵

新动作 `contract.signing-material-change` 的 GET preflight 与 POST mutation 均已满足：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- 有唯一生产页面消费者

全站综合矩阵将该 POST 判定为 `covered`；页面动作 blocker 从 298 降到 296。结果不明错误类已
移入纯 helper 文件，不再被误报为 API wrapper。合同专项解析器新增对
`governedContractPath(...)` 的测试和解析，`seal/approve`、`seal/complete`、
`signing/material-change` 三条既有页面入口现均为 `matched`，专项矩阵不存在缺失 wrapper。

本轮重生成后的全局基线为：395 条后端路由、380 个 Web wrapper、393 个 binding、4 条
`unclassified`、50 个页面动作、296 个 page blocker、321 个综合矩阵 blocker。全局仍保持
`blocked` 是因为 Task 11 剩余四条现行业务路由及既有全站缺口，不是本动作回退。

## 验证证据

- 目标 API：7/7 套通过，610 项通过、9 项既有 legacy 条件跳过；
- 其中 ApprovalFormService + FileService：264 项通过、9 项既有条件跳过；合同/零采专用下载
  均由真实跨服务归档锚点验证，不以 mock 代替 file/template/claim/SHA 校验；
- 目标 Web：2 个文件、121/121；
- 共享状态规则：7/7；
- API 全量：270 套通过、19 套条件跳过，5317 项通过、51 项跳过；
- Web 全量：153 个文件、1537/1537；
- shared-domain 全量：15 个文件、150/150；
- API/Web/shared-domain typecheck、lint、production build：通过；
- Web `check:ui`：通过；
- API 业务英文错误检查：扫描 400 个生产 TypeScript 文件，54 处允许的内部英文哨兵；
- Prisma validate：使用不监听的本机虚拟 URL 通过，未建立数据库连接；
- Prisma Client：依赖目录被本地运行时重建后，按用户既有明确授权在本机重新生成成功；Schema
  未修改；
- 合同专项解析器：新增 RED 后最终 19/19；专项矩阵 write/check 为 `matched`；
- 五套全站清单 write/check：均与生成物一致；当前全局阻断数字如上，未运行 `--require-ready`；
- `git diff --check`：通过；
- Web production build 仅保留既有大 chunk 告警。

全量 API 中的 Fontconfig 警告来自本机只读字体缓存不可写，不影响 270 套/5317 项通过结果。

## 独立复核与剩余证据

独立代码复核最终结论：

- P0：0
- P1：0
- P2：3 项运行级补强证据仍待后续总门禁：
  1. 真实 PostgreSQL 双请求单赢家与 Audit 中段故障回滚；
  2. 同一合同完整“实质变化 → 新审批通过 → 新审批单/新用章任务”集成链；
  3. mounted Vue 组件 A→B 路由切换时迟到 resolve/reject 的浏览器级断言。

独立复核另登记一项非阻断输入韧性建议：实质变化原因当前校验非空白，但未设业务层显式长度
上限；如产品需要固定上限，应在后续统一敏感操作 DTO 约束中明确，不能在本切片静默猜测长度。

本切片没有获得启动 Docker/PostgreSQL 或 preview 的独立授权；此前对零采限定 runner 的授权不
延伸到合同实质变化，因此未把单元 CAS/回滚测试伪装成真实 PostgreSQL 或浏览器证据。上述 P2
须在 Task 11/最终浏览器和空库门禁中补齐；未补齐前不构成精确发布候选。

## 下一步

本切片可提交聚焦 conventional commit。Task 11 下一条现行业务阻断是
`POST /contract-bills/:billId/rows/:rowKey/remainder-cancellation`，随后是项目垫资额度 F0/F1/F2/F3
三条动作。四条全部闭合并补齐运行级证据前不得进入 Task 12，也不得把本切片外推为实施包 5
或五包发布候选完成。
