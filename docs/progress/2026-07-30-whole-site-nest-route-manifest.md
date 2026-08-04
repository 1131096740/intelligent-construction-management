# 实施包 5 Task 11：全站 Nest 路由与守卫元数据清单

日期：2026-07-30

状态：Task 11 第一份 machine-readable manifest 已本地完成；Web API
wrapper/真实消费者、页面可见动作以及最终 whole-site 能力矩阵仍未完成。

## 本切片范围

本切片只登记能够由构建产物和 Nest 运行时确定的事实：

- controller、handler、HTTP method 和实际 Nest path；
- 规范化后的 `method + path`，动态参数统一为 `:param`；
- `@Public()`、`@RequirePositions()`、`@RequireProjectRole()`；
- `@ContractCutoverSurface()` 和 `@ContractCutoverLegacyWrite()`；
- controller/handler 对应的 TypeScript 源文件。

每条记录均显式声明 `authorizationScope=guard_metadata_only`。经办人、资源归属、
审批冻结节点、委托、文件 ACL 以及 service/transaction 内的不变量不在本清单
范围内，因此本清单不能单独证明完整授权策略。

## 失败证据与最小实现

首轮测试在核心 helper 尚不存在时以 `ERR_MODULE_NOT_FOUND` 失败。随后新增：

- `scripts/lib/whole-site-route-manifest.mjs`
- `scripts/inspect-whole-site-capabilities.mjs`
- `scripts/inspect-whole-site-capabilities.test.mjs`
- `docs/product/manifests/nest-business-routes.json`
- 根脚本 `inspect:whole-site-capabilities`

检查器先使用新构建的 API 产物创建 Nest application，不监听端口、不连接
数据库，文件存储指向临时目录，并停用合同文档后台轮询器；随后从
`ModulesContainer` 读取实际 metadata，并在 `app.init()` 后与 Express route
stack 的规范化多重集做双向一致性校验。临时环境变量、application 和临时目录
均在成功或失败路径恢复；关闭失败也会使检查器失败。

以下情况全部失败关闭：

- 规范化后的 method/path 重复；
- runtime handler 缺少唯一源码映射；
- metadata 路由和 Express 实际路由双向漂移；
- API/shared 源码或构建配置晚于 `dist/app.module.js`，以及构建产物缺失；
- 未知岗位、未知 BusinessAction 或非法 guard metadata；
- `Public` 与岗位/项目动作同时声明；
- legacy-write 未同时声明 cutover surface；
- baseline 缺失或内容漂移；
- CLI 参数非法。

CLI 失败只输出固定错误，不回显输入路径、参数或内部异常。检查器用纳秒级
mtime 核对 API/shared 全部 TypeScript 源码及 package、tsconfig、lock、
workspace 和 Nest 配置；直接 CLI 也会拒绝陈旧或缺失的 `dist`。正式门禁仍
使用根 `pnpm inspect:whole-site-capabilities`，其 pre-hook 会先重建 shared
domain 和 API。

Express 4.22 会把 `app.all()` 展开为完整 method 集合；检查器以平台实际
`methods` 集合识别这种 layer，并与 Nest `RequestMethod.ALL` 对照为一条
`ALL`，不会把合法的未来 `@All()` 错报为 runtime drift。

## 生成结果

基线文件 SHA-256：

`62580430a97217233e458e2246bf76144c9f2c83e62ab8dce56d6cecc68a3a80`

| 指标 | 结果 |
| --- | ---: |
| schemaVersion | 1 |
| controller | 40 |
| controller source file | 38 |
| route | 395 |
| exact method/path | 395 |
| normalized method/path | 395 |
| public | 6 |
| authenticated | 389 |
| authenticated_only | 115 |
| positions | 91 |
| project_action | 183 |
| positions AND project_action | 0 |
| cutover surface | 92 |
| legacy write | 2 |
| Public + business guard conflict | 0 |
| metadata/Express drift | 0 |

## 验证

- `node --test scripts/inspect-whole-site-capabilities.test.mjs`：16/16；
- `node scripts/inspect-whole-site-capabilities.mjs --write`：395 routes；
- `node scripts/inspect-whole-site-capabilities.mjs --check`：395 routes；
- `CI=true pnpm run inspect:whole-site-capabilities`：shared/API 新构建后
  395 routes，baseline 一致；
- 三个新增 `.mjs` 文件 `node --check`：通过；
- `git diff --check`：通过。

本机依赖复核期间曾误调用与仓库 lockfile 不兼容的桌面 bundled pnpm；它只重建
本地 `node_modules`，未改源码或 lockfile。随后使用项目 pnpm 9.15.9 按冻结
lockfile 恢复 836 个依赖，并按既有授权重新生成 Prisma Client；再次执行上述
构建和检查通过。

## 未完成项与边界

本切片不等于 Task 11 完成，尚需按顺序补齐：

1. 全部 Web API wrapper、method/path 和从正式入口可达的真实消费者清单；
2. 页面可见业务动作、服务端 action/capability 与 API wrapper 绑定清单；
3. 后端路由的页面、内部任务、外部接管或退出分类；
4. `docs/product/whole-site-capability-matrix.md` 及三份清单的交叉失败门。

本地静态/运行时清单不替代生产零调用观察证据，不授权 Task 12 旧接口退出，
也不授权 C1/C2/M3、retention、业务写入或任何物理删除。本切片未连接生产、
未 push、未合并、未部署、未执行生产迁移或修改生产数据。
