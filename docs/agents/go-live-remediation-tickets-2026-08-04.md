# PR #1 上线修复票据

基线：`497ee06e939f8cf3c447bc59f72d035669d96d7e`
原则：依赖未完成不得开始后续票；每票先写可失败测试，再实施最小修复、验证和 code review 等价审查。

## Blocking edges

```text
GLR-00 范围与基线 spec
  ├─> GLR-01 POST /files 权限旁路
  ├─> GLR-02 结算审批失效状态稳定 409
  ├─> GLR-03 99 blocker / 3 duplicate mutation route
  └─> GLR-04 CI 动态数据库门 / require-ready 硬门

GLR-01 + GLR-02 + GLR-03 + GLR-04
  └─> GLR-05 精确 SHA 证据绑定 / diff check

GLR-01 + GLR-02 + GLR-05
  └─> GLR-06 RC-06 真实岗位浏览器长链、503、幂等、移动端文件

GLR-04 + GLR-05 + GLR-06
  └─> GLR-07 RC-09 备份监控停写 / 阶段 F 演练

GLR-07
  └─> GLR-08 最终 Go/No-Go 与生产授权请求
```

## 票据与验收条件

### GLR-00 — 固化范围和审查基线

状态：已完成（本文件与 `go-live-remediation-spec-2026-08-04.md`）。

验收：记录 PR、分支、起点 SHA、worktree、远端 refs、非目标和禁止动作；不把旧证据绑定到新候选。

### GLR-01 — 修复 `POST /files` 权限旁路

状态：已完成（本地候选，尚未 push/合并/部署）。

前置：GLR-00。验收：未授权岗位稳定拒绝；授权业务路径保持可用；测试证明 Guard → ValidationPipe → Service 顺序；上传仍是私有对象并保留审计和幂等。通用上传精确允许 `contract_staff`、`contract_director`、`finance_staff`、`finance_director`，以覆盖合同模板治理中“合同主管本人上传并创建”的所有权约束，不放行 `employee` 等无关岗位。证据：48/48 `services/api/src/file/file.controller.spec.ts`、API typecheck、API lint、`git diff --check`。

### GLR-02 — 结算审批过期状态返回 409

状态：已完成（本地候选，尚未 push/合并/部署）。

前置：GLR-00。验收：过期/非 `approval_pending` 状态稳定返回 HTTP 409 和 `SETTLEMENT_APPROVAL_REVIEW_CONFLICT`；不会 500、不会推进状态、不会产生副作用。已有无唯一进行中实例、重复审批冲突测试继续通过。证据：结算服务 158/158、API typecheck、API lint、`git diff --check`。

### GLR-03 — 收敛治理 blocker 与重复 mutation route

状态：已完成（本地候选，尚未 push/合并/部署）。

前置：GLR-00。验收：99 blocker 有逐项归属；3 个重复 mutation route 要么合并为唯一语义路由、要么明确迁移/退出并有消费者证据；manifest `--check` 与 `--require-ready` 对真实问题 fail closed，最终不靠豁免隐藏。

证据：3 个重复写路由已收敛为业务域唯一上传/提交入口，新增 `retired-web-api-wrappers.json` 对原 93 个无生产消费者 wrapper 逐项记录文件、名称、分类和理由；manifest 当前 `ready`、432 wrappers/452 bindings、0 orphan、0 duplicate write、0 frontend-without-backend，页面动作 manifest 当前 `ready`、0 blocker。新增 live gate `scripts/go-live-remediation-manifest.test.mjs` 通过；manifest/capability/route-usage Node tests 83/83、API 控制器 321/321、Web API 定向测试 221/221、API/Web typecheck、lint、UI check、`git diff --check` 通过。本票未连接生产、未 push、未合并或部署。

### GLR-04 — 加固动态数据库和 require-ready CI 门

状态：已完成（本地候选，尚未 push/合并/部署）。

前置：GLR-00。验收：动态 PostgreSQL 迁移/测试在 CI 中真实运行；`--require-ready` 发现 blocker 时非零退出；成功门绑定当前 SHA；失败日志可定位。证据：候选 `4afc1019dfa8bf16934b096a08b57b611edde80c` 上一次性 PostgreSQL 16 动态门通过，118/118 migrations、54/54 tests、28/28 files、9 groups、`remainingTests=0`、`remainingFiles=0`；镜像 `sha256:33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20`；runner self-test 7/7、四类 `--require-ready` 静态门和 `git diff --check` 通过。CI 接线由 `scripts/go-live-ci-gates.test.mjs` 1/1 保护。本票证据仅绑定实现 SHA，GLR-05 仍须在最终候选 SHA 重跑并收口。

### GLR-05 — 精确 SHA 证据收口

前置：GLR-01、GLR-02、GLR-03、GLR-04。验收：所有报告、测试、浏览器和 manifest 证据同一精确候选 SHA；执行 `git diff --check`；工作树状态和命令可复核。

### GLR-06 — RC-06 生产等价浏览器长链

前置：GLR-01、GLR-02、GLR-05。验收：真实岗位长链在桌面与移动视口通过；包含 503、400/403/409、双击/重试幂等、移动端上传下载；无控制台错误、404、重复 POST；失败时保留证据并不宣称通过。

当前进展：真实隔离治理 UAT 已连续修复签名领域上传、合同版式上传和合同主管发起场景的合同所有者文件上传路径；审批前授权/审批正式文件走 `POST /contract-drafts/:versionId/files`，审批后最终正式文件保持通用 `POST /files`，并修复领域 multipart 入口的 `@Body("idempotencyKey")` 全局校验 400 问题。随后 P0-5B 发现结算签名准备仍使用通用入口，已改为 `/me/signature/canvas` 并按 `signatureFileId` 绑定；当前又确认结算模板治理要求 `contract_director` 本人拥有源 XLSX，故通用上传精确补入 `contract_director`，同时保留无关岗位拒绝。驱动器回归 4/4、runner 规格 5/5、文件控制器 48/48、领域控制器 12/12 通过，包含本修复的最终精确 SHA 尚未完成双浏览器长链复跑，故本票仍未完成。

### GLR-07 — RC-09 与阶段 F 演练

前置：GLR-04、GLR-05、GLR-06。验收：隔离恢复、迁移、构建/部署/readiness/回滚、监控日志、维护/停写/恢复在同一 SHA 上完成并有证据；生产业务数据不变。

### GLR-08 — 最终 Go/No-Go

前置：GLR-07。验收：P0、Task 11、RC-06、RC-09、阶段 F 全部通过；形成精确 SHA 证据包；仅向用户请求生产操作的单独授权，不自动执行 push/合并/部署。
