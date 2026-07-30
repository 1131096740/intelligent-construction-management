# 合同工作台 Release B 修复候选收据

日期：2026-07-30
运行代码 SHA：`338ecc3d176c155f8b66f5f8cfecdd18b64b4345`
基线：生产/远端 `main` 的 `0619dce268280fe169d34f75cc8ba758bad4c2a5`
状态：本地精确候选已通过门禁，等待新的生产与 JWT 授权。

## 1. 候选目的与差异

原候选在 Release B 当前经办人“内容完全相同聚合保存”中返回 400。只读 DTO 诊断证明前端保存载荷丢失后端必填的 `allowsEarlyPayment`。

本候选只做端到端原值透传：

- 共享合同工作台读模型声明该字段；
- Web API 读/写类型声明该字段；
- 草稿内存模型安全默认 `false`；
- 服务端读取值经过模型赋值、聚合快照和保存序列化原样写回；
- 不新增 UI 控件；
- 不改变付款审批、金额、权限、状态、租约、审计或 revision 规则；
- 不新增 Schema 或迁移。

相对 `0619dce…` 的运行代码变化为 5 个文件，另含测试、`PROGRESS.md` 和两份生产/回滚收据。提交链：

1. `ad9c254901d6fd1cea6df0c6d9e0094ce930e6fe docs: record contract draft aggregate transition`
2. `338ecc3d176c155f8b66f5f8cfecdd18b64b4345 fix: preserve contract early payment permission`

## 2. 五包状态矩阵

| 实施包 | 本地实现 | 生产状态 | 当前结论 |
| --- | --- | --- | --- |
| 1 草稿聚合基础 | 完成 | Release A 已部署 | 通过 |
| 2 合同清单/条款/文档工作台 | 完成 | Release A 后端已部署，前端待 Release B | 本候选修复付款阶段透传 |
| 3 历史接管与转换 | 完成 | 精确 transition 已完成 | 写后守恒、同批零写 |
| 4 项目资金与上下游事实 | 完成 | 兼容结构已部署 | 本候选无变化 |
| 5 切换、保留与发布门 | Release B 工具和回退门完成 | Release B 第三次尝试已回滚 | 等待新候选授权；retention/C1/C2 未授权 |

Release B 仍是生产动作，不因本地候选通过而自动完成。Release C1/C2、retention、旧接口物理删除和其他业务写入继续关闭。

## 3. 失败证据与定向修复验证

RED：

- `use-contract-draft.test.ts`
- 65 个测试中 1 个失败、64 个通过；
- 唯一差异为保存载荷缺少 `allowsEarlyPayment: true`。

GREEN：

- `use-contract-draft.test.ts` 与 `ContractClausesSection.test.ts`：72/72；
- 保存载荷保留读取到的 `true`；
- 通用直接付款样本保留 `false`；
- 草稿模型、冲突重载与聚合快照使用同一字段。

## 4. 测试与静态门禁

| 门禁 | 结果 |
| --- | --- |
| shared Vitest | 15 文件，149/149 |
| API Jest | 251 套、4,749/4,749；15 套/38 项按环境条件跳过 |
| Web Vitest | 139 文件，1,248/1,248 |
| 全仓 typecheck | 通过 |
| Web E2E typecheck | 通过 |
| 全仓 lint | 通过 |
| Web `check:ui` | 通过 |
| API build | 通过 |
| Web build | 通过；仅既有大 chunk 警告 |
| Prisma generate | v5.22.0 生成成功 |
| Prisma validate | 通过 |
| 能力矩阵 | 184 源码路由、138 Web API 请求、395 运行时路由；双向缺失均 0 |
| `git diff --check` | 通过 |

API 首轮曾因依赖恢复后 `.prisma/client` 不存在而在加载阶段失败；按用户授权重新执行 Prisma generate 后，同一 API 全量命令通过。该首轮是构建产物缺失，不是业务测试失败。

## 5. API、页面与权限对照

能力矩阵结果：

- 源码 Controller 路由：184；
- Web API 请求：138；
- 实际 Nest 运行时路由：395；
- 源码有但运行时缺失：0；
- 运行时有但源码缺失：0；
- 页面直接 `fetch` 新增：0；
- 生产旧路由观察窗口：本候选未新增，既有 legacy candidate 不删除。

本修复触及的单一链路：

```text
GET /contract-drafts/:versionId/workbench
  -> paymentTerms.stages[].allowsEarlyPayment
  -> ContractDraftFieldsModel.paymentAllowsEarlyPayment
  -> PUT /contract-drafts/:versionId
  -> paymentTerms.stages[].allowsEarlyPayment
```

后端仍负责租约、当前经办人权限、revision CAS、DTO、金额、状态和技术回执。页面没有直接访问数据库、对象存储或新增 `fetch`。

## 6. 迁移与幂等演练

本候选相对生产没有 Prisma Schema 或迁移文件差异。

仍对本候选重新执行隔离演练：

- 临时 PostgreSQL 16 仅绑定 `127.0.0.1`；
- 从空库顺序应用 109/109 迁移；
- `prisma migrate status` 为最新；
- 聚合转换首轮 `selected=1/processed=1/writes=4`；
- 同 batch 二次执行 `already_applied/processed=0/writes=0`；
- 数量守恒：contracts 1、versions 1、bills 1、billRows 1、parties 0、paymentTerms 1、files 1；
- 临时容器和临时目录完成后已精确清理。

生产第三次尝试的备份 `jiangkong-20260730-110426.dump` 另有 checksum OK、`pg_restore --list` 1,658 行和异机回执；它是回滚证据，不替代新一轮发布前备份。

## 7. 浏览器门禁

| 场景 | 浏览器 | 结果 |
| --- | --- | --- |
| P0 工作台壳与核心详情 | Chromium | 2 passed、2 个需配置条件场景 skipped |
| 合同清单专注编辑 | Chromium + WebKit | 8/8 |
| 响应式 | Chromium + WebKit | 桌面、960、640、375 全覆盖 |
| 清单业务 | Chromium + WebKit | 101 行 Excel 候选、唯一聚合保存、派生金额不回传、移动错误阻断 |

付款阶段布尔值的精确回归由 65 项草稿聚合单测覆盖；浏览器门禁用于证明候选构建、工作台入口、WebKit 和移动响应式没有回归。

## 8. 生产只读安全状态

第三次 Release B 回滚后：

- 生产 checkout：`0619dce268280fe169d34f75cc8ba758bad4c2a5`；
- `CONTRACT_CUTOVER_MODE=maintenance`；
- canary：0；
- API：active、health ok；
- 目标版本：draft、revision 12、正式编号空、未提交、审批 0；
- 有效租约 0；
- 有效七天保存回执 0；
- 项目接管 0；
- transition 审计仍为 1。

## 9. 新一轮 Release B 的授权门

此前“每账号一次 120 秒 token”的授权已经被第三次脚本重跑超用，不能复用。

进入生产前必须由用户重新明确授权：

1. 本文档提交后的精确候选 SHA；
2. 候选分支 push、`main` fast-forward、生产 checkout 更新；
3. 完整部署和人工确认窗口；
4. maintenance → release-b-maintenance 的三个 canary 精确集合；
5. 四个账号各自新的 token 次数和 120 秒时长；
6. 只有当前经办人获取自然过期租约并执行一次内容相同聚合保存；
7. revision 保持 12，只新增一条七天技术保存回执；
8. 其余三账号严格只读和 410/503/权限负向；
9. 全部通过后才允许 `CONFIRM` 并切到 release-b、canary 0。

未重新授权前维持生产 maintenance，不签发 token、不推送本候选、不更新生产、不执行任何业务写入。
