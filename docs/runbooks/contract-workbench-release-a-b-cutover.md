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
5. 使用 30 分钟内未截断的最新报告 SHA、batch、fingerprint、操作者用户 ID 和
   确认串运行 transition；UUID 与安全的历史 seed ID 均允许，事务内仍要求操作者
   存在且 active。
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

## 7. C1 / M0 生产只读零调用观测

本节只定义证据采集协议，不构成生产执行、工具部署、C1 代码退出、小程序退役或
任何删除授权。即使本地观测工具和能力门禁已经通过测试，把工具复制到生产、在生产
checkout 部署新 SHA，或读取生产访问日志执行统计，仍须另获用户明确授权并绑定精确
候选 SHA、生产部署 SHA、观察窗和允许的操作范围。

### 7.1 先锁定观察合同

每次观察必须在开始前保存一份不可变的操作声明，至少包含：

1. 获批的半开观察窗 `[from, to)`、显式时区、最小时长和报告新鲜度；时长与
   新鲜度只由当次授权声明确定，脚本默认值不能替代授权。
2. 观察时生产实际部署的完整 40 位 SHA，以及观察窗内发生部署或回滚时的分段
   边界；跨 SHA 的窗口不得合并成一条无版本报告。
3. `scripts/ops/production-route-observation-targets.json` 的文件 SHA-256、
   `schemaVersion` 和目标数量。该版本化清单必须完整覆盖能力检查器的 12 条旧
   合同路由，并唯一追加 `POST /auth/wx-login`，不得临时删减目标来制造零命中。
4. 生产实时 `nginx -T` 的脱敏摘要或受控原件哈希、实际 `access_log` 指令、
   `log_format`、server/vhost、监听端口和 `/api` 代理映射。必须先证明输入是
   工具支持的 Nginx combined 格式；不支持的自定义格式按阻塞处理。
5. 覆盖观察窗的 logrotate 文件全集，逐文件记录受控路径标识、大小、mtime、
   SHA-256 和顺序。当前日志及 `.gz` 轮转日志必须按最早到最新传入，不能只取
   当前 `access.log` 或只取看起来有业务流量的文件。

当前 `access.log` 会持续追加，不能用“先算一次哈希、稍后再整文件读取”声称两次
处理的是同一字节集合。证据窗口优先结束在自然轮转边界，并在轮转后使用不可变的
`.1`/`.gz` 文件；若当次授权要求包含当前文件，采集器还必须把同一次读取的 inode、
字节上界、大小和 SHA-256 与 observer 实际消费的精确字节绑定。做不到时按覆盖
阻塞处理，不得仅用可变文件的 mtime 或首末日志时间补证。

`coverageBasis=operator_attested` 只表示操作者声明了覆盖范围。observer 生成的
JSON、`inputSourceCount` 或首末日志时间都不能单独证明日志全集完整；必须与
`nginx -T`、logrotate 文件清单/哈希、部署 SHA 和观察授权一起归档。

### 7.2 排除日志旁路

在把 Nginx access log 当作生产零调用依据前，必须逐项盘点并形成“覆盖”或“阻塞”
结论：

- CDN/WAF 是否可能直接回答、缓存或把流量转发到另一源站，且其日志是否纳入；
- 是否存在多个 vhost、域名、端口或第二份 `access_log`；
- API upstream 是否能被公网、内网、容器网络或运维账号直接访问而绕过 Nginx；
- localhost/loopback 调用是否写入同一 access log；
- systemd、timer、cron、队列 worker、运维脚本和健康检查是否直接调用旧路由；
- 观察窗内是否发生日志轮转、截断、丢失、停写、时钟跳变、Nginx reload 或
  checkout 切换。

任何一条旁路无法证明已覆盖，就不得把目标计数为零解释成“生产零调用”。应把报告
标为阻塞，保持旧代码和数据隔离不变。

### 7.3 执行与隐私边界

取得生产执行/部署授权后，应在生产受控上下文就地读取 root/adm 可见日志，只持久化
脱敏汇总。不得把原始访问日志复制进仓库、证据目录或个人电脑，也不得输出或持久化
IP、User-Agent、原始 URI、query、token、微信 code 或业务记录 ID。

工具调用形状如下；`--log` 必须按时间顺序列出覆盖窗所需的全部文件：

```bash
node scripts/ops/inspect-production-route-hits.mjs \
  --from '<获批窗口起点>' \
  --to '<获批窗口终点>' \
  --coverage-from '<日志全集覆盖起点>' \
  --coverage-to '<日志全集覆盖终点>' \
  --api-prefix '/api' \
  --routes scripts/ops/production-route-observation-targets.json \
  --log '<最早轮转日志.gz>' \
  --log '<后续轮转日志>' \
  --log '<当前 access.log>'
```

observer 使用半开窗口、剥离 query、只统计 `/api` 前缀请求，并把动态参数归一为
模板。以下任一输入或覆盖异常必须非零退出且冻结 C1/M0 删除决定：

- 任一非空行不能按已证明的 combined 格式解析；
- 文件时间倒序、观察窗或覆盖窗无显式时区、结束时间在未来；
- 覆盖窗未完整包住观察窗、输入为空、窗口内没有请求或没有 `/api` 正向样本；
- 目标重复、语义冲突、路径编码含义不唯一或 OPTIONS 预检可能命中目标；
- 结构计数、输入文件数和解析总数不一致。

目标命中本身应作为真实统计保留，observer 不得把它改写成工具故障或过滤后重算；
任一目标计数非零都必须冻结删除决定并进入调用来源调查。

只把汇总 JSON 交给能力检查器；能力检查器还必须校验 `schemaVersion=1`、
`status=ready`、`complete=true`、`apiPrefix=/api`、覆盖窗、每条目标计数和结构
总数，再与实际 runtime route manifest、调用图和能力矩阵联合判定。缺少任一层
都只能写“生产证据未完成”，不能写“零调用已证明”。

### 7.4 探针顺序与阶段授权

先冻结观察窗、文件清单/哈希和脱敏统计报告，再在观察窗之外执行已授权的 404/410
退役探针。不得先打探针再从同一窗口声称目标零命中，也不得过滤探针命中后重算。

零调用报告通过后仍只满足 C1/M0 的一个前置证据：

- C1 删除旧调用代码并部署，必须另获精确 SHA 的代码退出/生产部署授权；
- C2 checkpoint/旧表旧字段物理清理必须另获独立物理删除授权；
- M1/M2 小程序入口关闭和专属运行时删除必须按各阶段另行授权；
- M3 `wxOpenid` 等数据清理必须另获独立物理删除授权；
- temporary-only retention timer 及其未来自动清理范围仍须单独授权，不能由本节
  或一次零调用报告自动开启。
