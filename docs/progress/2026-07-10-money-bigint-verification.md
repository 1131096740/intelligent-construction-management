# Phase 0B 大额金额本地迁移与 live 全链路验收证据

日期：2026-07-10

规格评审加固：2026-07-11

执行分支：`codex/phase0b-money-bigint-20260710`

执行范围：仅独立 worktree 和一次性本地测试环境

## 结论

Phase 0B 的 BIGINT 数据库迁移、金额字符串 API 契约和 bigint 内部计算已在一次性本地 PostgreSQL 中完成迁移与真实 HTTP/API 全链路验收。数据库迁移状态、21 个目标列、超出 JS 安全整数范围的金额精度、合同到财务入账闭环、失败事务回滚和本地环境清理均有可重复验证入口。

本结论只表示代码和本地迁移具备继续合并评估的条件，不表示已经发布或上线。未连接生产数据库，未执行生产迁移，未接入生产 API 或腾讯 COS，未推送、未部署，也未写入真实业务数据。

## 隔离与安全边界

| 项目 | 验收事实 |
| --- | --- |
| PostgreSQL | 使用本机已有 `postgres:16` 镜像启动一次性容器；只绑定 `127.0.0.1` 随机端口；容器名包含本次唯一时间戳。 |
| API | runner 显式设置 `HOST=127.0.0.1`；API 启动只在 HOST 非空时把 host 传给 Nest，因此本地验收仅监听回环，普通生产未配置 HOST 时保持原默认行为。live guard 同时拒绝其他 HOST。 |
| 文件 | 使用本次独立临时目录的本地文件存储；验证入口拒绝 COS 或其他非本地存储配置。 |
| 环境变量 | runner 构造最小本地测试环境，不加载生产环境文件，不复用生产数据库、COS 或业务密钥；数据库密码、JWT、下载签名和 seed 登录密码每次随机生成。随机 seed 密码真实用于哈希，seed 输出只保留账号摘要；runner 在转发输出前再次拒绝密码值或密码日志标记。 |
| 数据 | 只使用 seed/test 身份和唯一验证编号；不会导入真实数据。 |
| 清理 | 正常、异常与中断路径均停止 API、强制删除临时容器并删除临时目录。最终复核未发现残留容器、API 进程或临时目录。 |

运行时保护集中在：

- `services/api/src/database/money-bigint-live-verification.ts`
- `services/api/prisma/run-money-bigint-local.cjs`
- `services/api/prisma/prepare-money-bigint-local.cjs`

标准入口：

```bash
pnpm verify:money-bigint:local
```

## 迁移与数据库结构证据

本地 runner 依次执行迁移部署、迁移状态检查、seed、验证数据准备和 API 启动：

- 共应用 37 个 Prisma migration，包括 `20260710153000_money_bigint`。
- `prisma migrate status` 返回 `Database schema is up to date!`。
- 直接查询 `information_schema.columns`，确认清单中的 21/21 个金额或审批阈值列均为 `bigint`。
- 21 个目标列逐项显式声明预期默认值与可空性：18 个列必须没有默认值，3 个 `paidAmountCents` 必须保留等价 bigint 0；非默认列意外出现默认值、默认 0 缺失或变为非 0 都会失败。
- 直接查询 `_prisma_migrations`，确认目标迁移已成功完成且未回滚。

对应验证器：`services/api/prisma/verify-money-bigint.cjs`。

## live 全链路覆盖

| 场景 | 金额/输入 | 结果 |
| --- | --- | --- |
| 项目收款 | `9007199254740993` 分 | 通过 HTTP 写入并从 API 经营汇总读取，字符串与数据库值完全一致。 |
| 合同 | `2100000001` 分 | 创建、付款条款、审批、用章、归档、生效完成；数据库精确保存。 |
| 结算 | `2100000001` 分 | 创建、审批、归档、生效完成；合同版本和付款条款版本引用保持。 |
| 合同付款容量 | `2100000001` 分 | 结算生效后通过 `/payments/contract-application` 读取累计结算、应付、实付、审批中、已批待付、代付、累计占用、预付款扣回和最大可申请；逐字段要求精确 string，初始最大可申请为全额。 |
| 付款申请 | `2100000001` 分 | 规范十进制字符串输入，审批通过后进入待支付。 |
| 非法付款输入 | JS number、小数、指数、负数 | 均返回 4xx 中文错误，且数据库残留为 0。 |
| 第一次实付 | `1000000001` 分 | 上传独立凭证并登记，状态保持部分实付；API 容量读模型精确返回累计占用全额、已付 `1000000001`、剩余已批待付 `1100000000` 和最大可申请 `0`。 |
| 第二次实付 | `1100000000` 分 | 上传第二份凭证并登记；两次合计精确等于申请金额，API 容量读模型剩余已批待付精确为 `0`。 |
| 财务入账 | `2100000001` 分 | POST 响应 `amountCents` 明确为精确 string 且等于预期；数据库累计入账金额与付款、实付合计完全一致。 |
| PDF 与审计 | 付款闭环 | PDF 归档及关键业务审计存在；审批单行金额格式另有大额 bigint 自动化回归。 |
| 试运行预检 | 本地 seed/test 环境 | `verify-trial-run.cjs --preflight` 通过。 |

live 流程入口：`services/api/prisma/verify-core-flow.cjs`。

## 精度与事务回滚证据

- 精度哨兵统一使用 `9007199254740993` 分，它大于 `Number.MAX_SAFE_INTEGER`。
- 数据库直接验证合同、结算、付款申请、两次实付、结算累计已付和财务累计入账，所有值均以 bigint 精确比较。
- 在同一个数据库事务中写入超大金额报销请求和审批阈值后主动抛错；事务结束后查询两类记录均为 0，证明异常路径不会留下部分金额事实。
- 自动化测试验证审批单 PDF 行将 `9007199254740993` 分格式化为 `90,071,992,547,409.93 元`，不转换为 JS number。
- 自动化测试在内存中生成真实 XLSX 工作簿，并通过合同清单导入预检将单价 `90071992547409.93` 元精确解析为 `9007199254740993` 分。

## 自动化覆盖与 live 边界

以下规则已有自动化测试，但没有在本次 live 脚本中伪装成完整业务验收：

- 报销和零星采购的完整审批、实付、财务与 PDF 闭环由既有 `project-expense.service.spec.ts` 覆盖；本次 live 只补充超大金额数据库精度和事务回滚。
- 合同应付款分摊、预付款和人工调整由付款容量与服务测试覆盖；标准结算付款不会虚构 `PaymentExecutionAllocation`。
- 只有结算 `manual_adjustment` 允许有符号金额，普通付款非法负数由 live API 验证拒绝。
- PDF 大额金额文本和 XLSX 大额导入由目标回归测试覆盖；本次 live 上传的是脱敏验证文件，不声称完成真实版式人工验收。

目标回归命令与结果：

```text
pnpm --filter @jiangkong/api test -- approval-form.service.spec.ts contract-bill-excel.service.spec.ts money-bigint-live-verification.spec.ts --runInBand
3 suites passed, 27 tests passed
```

规格评审加固目标回归：

```text
pnpm --filter @jiangkong/api test -- api-listen.spec.ts seed-auth-runtime.spec.ts money-bigint-live-verification.spec.ts --runInBand
3 suites passed, 10 tests passed
```

全仓质量门禁：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm test` | shared-domain 7/7 文件、58/58 项；Web 40/40 文件、317/317 项；API 65/65 套件、1097/1097 项全部通过 |
| `pnpm --filter @jiangkong/api build` | 通过 |
| `pnpm --filter @jiangkong/web-admin build` | 通过；仅保留既有大 chunk 警告 |
| `pnpm --filter @jiangkong/web-admin check:ui` | 通过 |
| `git diff --check` | 通过 |

## 独立质量评审发现

当前生产代码中的普通付款审批节点仍为“项目经理 -> 合同/预算主管 -> 财务主管 -> 董事长/总经理”。这与已经确认的“经办人发起 -> 综合部主管 -> 项目经理 -> 财务总监 -> 董事长或总经理 OR 签”规则不一致。

本次验收按当前代码路径执行，只证明金额链路可运行，不能据此把审批业务规则判定为验收通过。该问题应作为发布前独立 P0 规则切片修正并增加审批实例冻结与 OR 签回归，不应混入本次 BIGINT 验证提交。

评审加严时曾发现非法 number、小数、指数和负数金额虽不落库，但金额解析器抛出的普通错误会被 Nest 映射为 HTTP 500。该问题已在独立提交 `279e6246` 中最小修复：外部金额字符串解析改为客户端异常，付款正金额包装保留中文业务原因，数据库 bigint 不变量仍使用内部错误。目标测试覆盖 4 类非法输入返回 400、事务未开启，并保留结算人工调整负数的合法例外；本次 live 再严格验证 4xx 中文响应和数据库 0 残留。

## 仍未执行

- 合并到 `main`。
- 推送远端或创建发布。
- 腾讯云生产数据库备份、迁移与回滚演练。
- 生产 API、Web、Nginx、域名和 HTTPS 复验。
- 腾讯 COS 私有桶上传、下载鉴权、短时链接和审计验收。
- 真实合同、结算、付款或项目支出数据初始化。

这些工作必须在后续发布任务中按独立闸门执行，不能由本地验证结果自动推导为已完成。
