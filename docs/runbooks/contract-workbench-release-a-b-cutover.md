# 合同工作台 Release A / Task 6 / Release B 切换手册

状态：本地候选执行手册；生产执行必须另获用户明确授权。

本手册只覆盖增量后端 Release A、ready 草稿 transition、短维护窗口和 Release B
前后端切换。它不授权真实业务数据写入、retention apply、C1 旧代码删除、C2/M3
物理清理或 COS 对象删除。

## 1. 固定控制面

| `CONTRACT_CUTOVER_MODE` | 合同工作台与历史接管写入 | 旧 PATCH / 旧单确认 |
| --- | --- | --- |
| `release-a` | 全部兼容 | 继续可用 |
| `maintenance` | 全部冻结；GET、导出和敏感预览票据保留 | 503 维护提示 |
| `release-b-maintenance` | 仅 `CONTRACT_CUTOVER_CANARY_USER_IDS` 明确列出的新接口用户可写 | 固定 410 |
| `release-b` | 新接口全部开放 | 固定 410 |

Canary 只允许 1–8 个明确用户 ID，不允许 `*`、重复值、空项或岗位名。名单只用于
用户已另行授权的 Release B 真实岗位烟测，不能把发布授权扩大为历史确认、更正、
付款或其他生产业务动作。

每次改动 `/etc/jiangkong/api.env` 后先运行生产 readiness，再重启 API 并核对
内外网 health。检查结果只打印 mode 和 canary 数量，不打印用户 ID。

## 2. Release A

前置条件：

1. 获得 Release A 生产授权。
2. 远端、main 和候选 SHA 已只读核对。
3. 最新自然备份及候选隔离恢复演练通过。
4. API 环境明确为 `CONTRACT_CUTOVER_MODE=release-a`，canary 为空。
5. 生产只读草稿预检已保存报告 SHA、batch 和数据库 fingerprint。

部署必须显式绑定精确候选并只切 API：

```bash
CANDIDATE_SHA_CONFIRMATION='<获批的 40 位候选 SHA>' \
DEPLOY_SCOPE=api-only \
DEPLOY_CONFIRMATION_MODE=immediate \
/opt/jiangkong/scripts/ops/deploy-production-server.sh
```

脚本在构建、备份、停服或迁移前验证：

- 确认值是 40 位小写 SHA；
- checkout HEAD 与确认值完全相同；
- tracked/untracked 工作树为空；
- API-only 不构建、快照或替换 Web。

发布后只读验收 API/Nginx/PostgreSQL、迁移数、新精确 GET、权限负向测试，并抽样
证明旧 Web 仍能保存旧草稿。不得在 Release A 运行 transition 或 retention apply。

## 3. Task 6 维护窗口与 transition

仅在 transition 生产数据修改另获明确授权后执行：

1. 重新生成只读预检，不复用 Release A 前 fingerprint。
2. 人工清零或隔离 `blocking/manual_review/checkpoint-only`。
3. 将 mode 改为 `maintenance`，canary 清空，重启 API。
4. 验证合同台账 GET/导出仍可用；合同草稿、清单、文档变更和历史接管写请求固定
   返回 `503 CONTRACT_CUTOVER_MAINTENANCE`。
5. 使用最新报告 SHA、batch、fingerprint、操作者 UUID 和确认串运行 transition。
6. 立即只读核对数量/金额/文件守恒、聚合 GET、旧正式合同不变和二次幂等。
7. 保持 `maintenance`，不得提前开放写入。

提交前已分配正式编号必须使用受控工具固化合同部决定，不得直接回填
`firstSubmittedAt`、人工插入审批实例或重置编号序列。先保存 30 分钟内的新只读
报告，再执行：

```bash
pnpm --filter @jiangkong/api resolve:contract-draft-formal-code -- \
  --apply \
  --report '<最新只读报告>' \
  --contract-version-id '<精确版本 UUID>' \
  --decision '<retain 或 void>' \
  --expected-revision '<报告 revision>' \
  --expected-database-fingerprint '<报告数据库 fingerprint>' \
  --expected-report-sha256 '<报告 SHA-256>' \
  --actor-user-id '<合同部主管用户 ID>' \
  --reason '<合同部确认原因>' \
  --confirm 'RESOLVE_CONTRACT_DRAFT_FORMAL_CODE_<精确版本 UUID>_<retain 或 void>'
```

`retain` 只写绑定当前编号 SHA 的审计确认；`void` 清空当前编号、草稿 revision
加一并写审计，已分配序号永久不回收。两者都是生产业务数据修改，必须按目标版本和
决定另获明确授权。完成后必须重新运行只读预检；不得把处置前报告用于 transition。

transition 失败时保持维护窗口；数据库只做前向核对/修复，不自动回滚迁移或用
旧 fingerprint 重试。

## 4. Release B 延迟确认部署

Release B 必须另行授权，并在授权中逐项列出 canary 用户、目标记录、岗位、动作和
保留/清理结论。先把 mode 改为 `release-b-maintenance` 并写入明确 canary ID，
运行 readiness 后执行：

```bash
CANDIDATE_SHA_CONFIRMATION='<获批的 40 位候选 SHA>' \
DEPLOY_SCOPE=full \
DEPLOY_CONFIRMATION_MODE=manual \
DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=1800 \
/opt/jiangkong/scripts/ops/deploy-production-server.sh
```

脚本完成备份、前向迁移、API/Web 切换和健康检查后不会立即删除旧运行时快照；
它会等待：

```text
/run/jiangkong-deploy/<候选 SHA>.decision
```

等待窗口内至少验证：

1. 非 canary 新写返回 503，GET/导出正常。
2. 旧草稿 PATCH 和旧单确认对所有已登录用户返回
   `410 CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED`。
3. 获授权 canary 只按批准记录完成新草稿保存/刷新及双方岗位最小烟测。
4. API、Nginx、PostgreSQL、AuditLog、租约和错误日志正常。

全部通过后，在第二终端写入精确确认：

```bash
printf 'CONFIRM %s\n' '<获批的 40 位候选 SHA>' \
  | sudo tee '/run/jiangkong-deploy/<候选 SHA>.decision' >/dev/null
```

脚本读取后删除决定文件、结束回退窗口并清理临时快照。陈旧文件、符号链接、错误
SHA、多行或其他内容都按失败处理。

## 5. Release B 回退

烟测失败时，先把 API 环境恢复为 `maintenance`、清空 canary，但不要抢先重启；
再写入：

```bash
printf 'ROLLBACK %s\n' '<获批的 40 位候选 SHA>' \
  | sudo tee '/run/jiangkong-deploy/<候选 SHA>.decision' >/dev/null
```

等待中的部署进程会恢复旧 API/Web 快照，重启 API、重载 Nginx并重新检查 health。
数据库迁移保持前向兼容，不声称已自动回滚。决定文件缺失直至超时也会自动恢复
旧运行时；此时继续保持写冻结，人工确认环境 mode 后再决定重试或恢复 Release A
旧写。

禁止用 kill、删除快照目录或手工覆盖运行目录代替决定文件。若主机异常导致部署
进程未完成，先保存日志和 `.deploy-rollback.*` 目录证据，再按生产事故流程处置。

## 6. 解除维护与留痕

最小 canary 烟测通过并确认新运行时后：

1. 把 mode 改为 `release-b`，清空 canary；
2. 运行 readiness、重启 API、核对 health；
3. 重测旧路由 410、新接口岗位权限和一个真实草稿闭环；
4. 在 `PROGRESS.md` 记录候选 SHA、迁移数、备份/恢复证据、决定类型、烟测证据、
   旧路由命中计数和未执行事项。

进入 C1 前仍必须完成 3–5 份真实合同闭环、至少一份历史接管后结算/付款验证和
批准观察窗口内旧路由零调用。C2/M3 物理清理继续使用独立授权门。
