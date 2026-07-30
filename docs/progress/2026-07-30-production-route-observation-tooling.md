# 生产旧路由零调用观测工具本地收口

日期：2026-07-30
状态：本地工具就绪；生产证据尚未采集；C1/M0 未完成

## 结论

本轮形成了生产访问日志脱敏聚合 observer、版本化目标清单和收紧后的能力检查
门禁。它们能在输入满足明确格式与覆盖合同后，对旧合同工作台路由和
`POST /auth/wx-login` 生成可直接交给能力检查器的汇总 JSON，并对多类假零证据
失败关闭。

本轮没有把工具部署或复制到生产，没有读取或持久化生产原始访问日志，没有生成
获批观察窗的生产命中报告，也没有执行 404/410 探针。因此：

- 不声称批准窗口内旧路由零调用；
- 不声称 C1 旧调用代码退出完成；
- 不声称 M0 小程序只读依赖盘点完成；
- 不授权或执行 C2/M3 物理清理、retention timer 或其他生产修改。

## 本地实现

| 文件 | 本轮作用 |
| --- | --- |
| `scripts/ops/inspect-production-route-hits.mjs` | 读取按时间排序的 Nginx combined 普通/`.gz` 日志，按半开窗口生成脱敏路由计数 |
| `scripts/ops/production-route-observation-targets.json` | `schemaVersion=1`、`apiPrefix=/api` 的版本化 13 项目标清单 |
| `scripts/inspect-contract-workbench-capabilities.mjs` | 对生产命中证据的 schema、窗口、覆盖、计数和结构一致性失败关闭 |
| 对应三个 `*.test.mjs` | 锁定 observer、能力门禁和目标清单契约 |

目标清单完整包含能力检查器的 12 条默认旧合同路由，并唯一追加
`POST /auth/wx-login`。它不是人工抄写的临时参数；清单测试会在默认旧路由变化时
暴露漂移并锁定清单唯一性，observer 另行拒绝重复或冲突目标。

observer 的输出只包含：

- 规范化观察窗与覆盖窗；
- 规范化 route template 及聚合计数；
- 输入源数、总行数、窗口前/内/后行数、匹配/未匹配数和解析失败数；
- 固定 schema/status/coverage basis/API prefix。

输出不包含 IP、User-Agent、原始 URI、query、token、微信 code 或动态业务 ID。

## RED / GREEN 与验证

本轮先以失败证据锁定风险，再做最小实现：

- observer RED 覆盖动态参数与 query 泄漏、错误 `/api` 前缀、HEAD/OPTIONS、
  非 combined 行、无时区/未来/未覆盖窗口、空证据、重复/冲突目标、乱序日志和
  普通/压缩多文件输入；
- capability gate RED 证明旧版可接受不完整、不可核验或未来 coverage 的
  `legacyHits`，也未强制全部旧路由、结构总数和唯一规范化 route key；
- targets RED 在未导出同源默认旧路由时直接失败，避免另维护一份静默漂移清单。

GREEN 结果：基础 observer + capability 联合门先通过 26/26；随后为版本化对象
清单补入 `schemaVersion`/`apiPrefix` 一致性保护，并锁定 410/503 等响应状态也必须
计为真实调用，最终联合结果为：

```text
node --test \
  scripts/ops/inspect-production-route-hits.test.mjs \
  scripts/inspect-contract-workbench-capabilities.test.mjs

28 tests passed, 0 failed
```

版本化目标清单独立验证：

```text
node --test scripts/ops/production-route-observation-targets.test.mjs

2 tests passed, 0 failed
```

本轮三组最终合计 30/30 通过；其中基础 observer + capability 联合门的
26/26 证据仍被保留并由后续保护增量覆盖。

上述测试只使用合成日志，不是生产零调用证据。

## 安全边界

### 代码内已经失败关闭

- 观察窗与覆盖窗必须为显式时区 ISO 时间，使用 `[from, to)`，结束不得在未来；
- 覆盖窗必须完整包住观察窗，输入不得为空，窗口内必须有请求和 `/api` 正向样本；
- 每个非空日志行都必须解析，输入文件必须按时间单调递增；
- query 在匹配前移除，歧义编码、路径穿越形状和 OPTIONS 预检按阻塞处理；
- 动态参数只输出 `:param`，目标重复或语义重叠直接拒绝；
- capability gate 要求 ready/complete/schema/API prefix、非负安全整数、全部旧
  路由计数、结构计数守恒、覆盖窗包含观察窗且不在未来；
- CLI 错误只输出固定 code，不回显损坏 JSON、日志行或敏感值。

### 代码不能单独证明

`coverageBasis=operator_attested` 是外部覆盖声明，不是日志完整性的密码学证明。
生产执行时仍须把汇总报告与以下证据绑定：

- live `nginx -T`、实际 `access_log`/`log_format`、所有 vhost/端口和 `/api`
  upstream 映射；
- 覆盖观察窗的 logrotate 文件全集、顺序、大小、mtime 和 SHA-256；
- 观察窗内精确生产部署 SHA、部署/回滚分段；
- 当次授权声明的观察窗、最小时长和报告新鲜度；
- CDN/多 vhost/直连 upstream/localhost/systemd/timer/cron 等日志旁路盘点。

持续追加的当前 `access.log` 还需要把 observer 实际消费的同一字节集合与 inode、
字节上界、大小和 SHA-256 绑定；不能把单独时刻的文件哈希和稍后的整文件读取拼成
同一份证据。优先等待自然轮转后使用不可变的 `.1`/`.gz` 文件。

若任一来源未覆盖、日志缺失/截断/乱序、格式不符、解析异常或目标有命中，必须
冻结 C1/M0 删除决定。原始生产日志不得复制进仓库或个人设备；只允许在另获授权的
生产受控上下文就地统计并保存脱敏汇总。

统计必须先于 404/410 探针。先固化观察窗、输入文件哈希和汇总，再在窗外运行探针，
避免用自己产生的命中污染或过滤零调用证据。

## 尚未完成与下一步

当前仍须保留原五包审计中的全部阻塞：

1. 原索引所指、可复现约 5 元差异的真实 75 万元 Excel 尚未取得或由用户批准替代；
2. 3–5 份真实合同闭环、真实岗位权限长链和至少一份历史接管后结算/付款尚未形成；
3. 9 个 `contract_bill_import_preview` 与未来 04:30 temporary-only timer 未获
   明确授权，现有 timer 继续 disabled/inactive；
4. C1、M0/M1/M2、C2/M3、业务草稿 purge、旧表/旧字段和正式业务数据物理删除
   均未获本轮授权。

下一步不是直接删除，而是先取得“生产执行/工具部署 + 精确部署 SHA + 观察窗 +
最小时长/新鲜度”的明确授权，按 runbook 完成日志覆盖和旁路盘点，再在生产就地
生成脱敏统计。只有联合证据通过，才可另行申请 C1 代码退出或 M1/M2 阶段授权。
