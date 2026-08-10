# 生产路由 observer 安全输入规格

日期：2026-08-10
状态：已获产品确认；只授权后续拆票与本地 TDD，不授权 Nginx 配置写入、部署、生产日志读取、`410`、tombstone 或任何生产数据操作

适用范围：`scripts/ops/inspect-production-route-hits.mjs`、其版本化 target manifest 和
Issue #57 的生产零调用前置证据。

## 1. 事实与问题

2026-08-10 已获授权的只读观测使用 14 个不可变轮转 access log、16 条版本化目标路由
和 checksum 一致的 observer。observer 返回 `ambiguous_request_target`，没有生成计数报告。
脱敏分类确认至少存在一条潜在 `/api` 非 combined 输入及四条潜在 `/api` 双斜杠路径；同一
14 天窗口还跨越 21 个生产 HEAD SHA。该次尝试因此不是零调用证据。

现有 combined log 保存原始 request target。它不足以让 observer 对无法规范化的输入推断
“一定不可能进入 `/api`”。仅过滤看起来无关的异常行会把不确定性改写成零命中，违反当前
fail-closed 规则。

## 2. 目标与不变量

1. 任何可能到达 `/api` 的路径身份不确定，必须阻断零调用结论；不得降级为未匹配请求或
   过滤后重算。
2. observer 输出继续只含窗口、route template、聚合计数和结构化安全计数；不得输出或
   持久化 IP、User-Agent、原始 URI、query、token、业务 ID 或原始日志行。
3. Issue #57 的三条 party 写入路由继续保留在版本化 target manifest 中；没有
   `status=ready`、`complete=true`、零命中和完整旁路证据时，不得实施 `410` 或 tombstone。
4. 原始 combined access log 继续保留为运维输入；它的解析失败不能被代码猜测性修复。

## 3. 受信任的路由观测输入接缝

后续独立运维实现可以新增一个与现有 access log 并行的、脱敏的 Nginx 路由观测日志。它
每行只记录：显式时区时间、`$request_method`、Nginx 最终规范化 `$uri`、HTTP 状态和
`$upstream_status`。它不得记录 `$request`、`$request_uri`、query、remote address、
User-Agent、cookie、token 或业务载荷。

该输入接缝只在以下条件全部可验证时才可用于 observer：

- `/api` 代理 location 的最终规范化 `$uri` 与 access log 记录的 `$uri` 是同一次请求；
- 任何内部 rewrite、location 迁移或 upstream 失败不会让 `$uri` 的记录与实际 `/api`
  路由身份脱节；无法证明时阻断；
- 新日志独立 daily rotate，观察窗的全部文件、顺序、大小、mtime 和 SHA-256 可绑定给
  observer 实际读取的字节；
- Nginx 配置、vhost、端口、CDN/WAF、direct upstream、loopback、systemd/timer/cron
  等旁路仍按既有 runbook 单独证明覆盖。

这不是对当前 production Nginx 的授权，也不取代现有 combined log 的安全或运维价值。

## 4. Observer 行为契约

当且仅当显式选择该受信任输入格式时，observer 可以读取其规范化 `$uri`：

- 输入 schema、字段数、显式时区、HTTP method/status、`$uri` 语法、文件顺序、覆盖窗和
  未来时间保持严格验证；任一异常固定失败，不回显原行；
- `$uri` 在匹配前不得包含 query、fragment、反斜杠、百分号编码歧义、双斜杠或 `.`/`..`
  路径段；任何不确定的 `/api` 身份阻断；
- 非 `/api` 的**已验证规范化** `$uri` 可以作为安全 aggregate 未匹配请求，而不是因原始
  request-target 形态阻断；
- `HEAD` 继续按 `GET` 统计；可能命中目标的 `OPTIONS` 继续阻断；`410`、`503` 等响应
  继续计为真实目标调用；
- 报告仍须由 capability gate 验证 schema、窗口、coverage、所有 target、结构计数和
  `apiPrefix=/api`，再结合旁路和部署 SHA 结论。

当前 combined 模式的行为不变：任一非空行无法证明为 combined 或 request target 不可
规范化，仍 fail-closed。

## 5. TDD 验收

后续实现先写失败测试，至少覆盖：

1. 规范化 route-observation 输入可统计 16 条 target，并且输出不含动态 ID 或任何敏感字段；
2. 已验证的非 `/api` 规范化路径仅增加安全 aggregate，不阻断；
3. 空字段、未知 schema、无时区、非法 `$uri`、双斜杠、编码歧义、`.`/`..`、缺失文件、
   覆盖缺口和未来窗口均阻断；
4. `/api` 目标、动态参数、`HEAD`、`OPTIONS`、`410` 和 `503` 保持既有计数/阻断语义；
5. combined 模式保持现有每行 fail-closed 回归，不因新格式而放宽；
6. capability gate 拒绝混用、旧 schema、漏 target、计数不守恒或未证明的观测报告。

本地合成日志测试不构成生产零调用证据。

## 6. 拆分与授权边界

1. **本地 observer 适配票**：实现/测试新输入 schema 和 capability gate，不能改 Nginx
   配置、部署或读取生产日志。
2. **生产观测日志接缝票**：在单独复核后才可改 Nginx 配置和 logrotate；必须另获生产
   配置/部署授权，并验证不泄露敏感内容。
3. **新观察窗**：只在单一生产 SHA 的不可变归档日志形成后，另获精确 `[from,to)`、
   最小时长、新鲜度、部署 SHA 和允许范围授权。
4. **Issue #57 tombstone**：仅在上述观测报告与旁路证明均完成后，另获其 `410`、调用方
   移除和部署授权。
