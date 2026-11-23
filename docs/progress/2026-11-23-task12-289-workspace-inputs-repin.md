# `.github/task12-install-289/*workspace-inputs.json` 摘要重钉回执

- 日期：2026-11-23
- 工作树 `/tmp/jgN`，分支 `line-n-rebaseline-289`，基线 `81338119c`
- 目标：line-l 调整部署 ACL（`services/api/prisma/general-procurement-runtime-grants.sql`）后，289 历史清单里钉的 grants 摘要 `c6ed1b2f…` 失效；按约定由本轮重钉这几份文件。未 push、未动票、未动 `/tmp/jgL` 与主仓库。

## 1. 摘要来源核对

| 项 | 值 |
| --- | --- |
| 钉点所在行 | `{"path":"services/api/prisma/general-procurement-runtime-grants.sql","sha256":"…"}` |
| 旧值 | `c6ed1b2f8a3d1ba7c5a4aa38087cd2425a8a2e5441c39790eeed3734f4412b09` |
| 新值（当前文件 sha256） | `0e67f9832f589f48c236b0964c0bb74e9a2f3c18798995014c5ac2be703f9324` |
| 旧值来源验证 | `git show cf0bac2f7^:services/api/prisma/general-procurement-runtime-grants.sql \| sha256sum` = `c6ed1b2f…` |
| 新值来源验证 | `git show cf0bac2f7:… \| sha256sum` = `0e67f983…`；当前工作树文件同为 `0e67f983…` |
| 变更提交 | `cf0bac2f7 fix(ci): 按最小权限补齐 323 独有函数的夹具与部署授权` |

每一份清单都只有这一行变化（`git diff --numstat` 均为 `1 1`），未改其它字段。

## 2. 8 份清单（旧值 → 新值）与新文件摘要

| 清单 | 行数 | 旧值 | 新值 | 改后文件 sha256 |
| --- | ---: | --- | --- | --- |
| `.github/task12-install-289/workspace-inputs.json` | 2536 | `c6ed1b2f…` | `0e67f983…` | `3cab991f4d096e16c0b61b98ec1f69835445f197575dce5339cc4ba4e660bc8e` |
| `draft-workspace-inputs.json` | 2536 | `c6ed1b2f…` | `0e67f983…` | `0537ad8ee4a2f4c7717b6bd07b759ce35ca9eadaac16aed6f3b2e2b2f99d7d4a` |
| `template-workspace-inputs.json` | 2536 | `c6ed1b2f…` | `0e67f983…` | `46fa7e428321b7b9f7eb9e46ecbcf77fed897378e18eef0a41bac1f59f9c942c` |
| `pol108-core-workspace-inputs.json` | 2537 | `c6ed1b2f…` | `0e67f983…` | `c81593939d30983714e5d3331dbebd95b4fde887963882171ba09070f5acd966` |
| `pol108-scale-workspace-inputs.json` | 2537 | `c6ed1b2f…` | `0e67f983…` | `218aca1506364b8d7fb0a026ebe400d1da38849296bff8128329c2b219728ee6` |
| `invoice-workspace-inputs.json` | 2536 | `c6ed1b2f…` | `0e67f983…` | `c4c0eb89c37ae486b101d2acff26433ef024b2efdb839cd7ae24a68ed6133d53` |
| `pol109-workspace-inputs.json` | 3684 | `c6ed1b2f…` | `0e67f983…` | `a56377b010b0a945158d7d5f5dd1a3d491a21f5c66c706a0230169d1968e8088` |
| `pol275/workspace-inputs.json` | 2537 | `c6ed1b2f…` | `0e67f983…` | `4a30950994b3212983cd5661b3989e845c39ad7259c96f2e5f6314969e51018a` |

`procurement/workspace-inputs.json` 未钉该摘要（11 行，另一种清单），未改。

## 3. 必要的下游自封（cascade，不属于 323 pin）

这些文件把「清单文件本身的 sha256」当 seal，改清单后必须同步，否则入口会在 seal 检查处失败：

| 文件 | 旧 seal → 新 seal | 说明 |
| --- | --- | --- |
| `.github/task12-install-289/settlement-workspace.sh` | 6 个：`18bd7ffd…`→`3cab991f…`、`60a4b603…`→`0537ad8e…`、`3a720e52…`→`46fa7e42…`、`b42196c1…`→`c8159393…`、`9a4d201e…`→`218aca15…`、`2f91f817…`→`c4c0eb89…` | settlement/template/draft/pol108-core/pol108-scale/invoice 的 inventory seal |
| `.github/task12-install-289/pol275/workspaces.sh` | `c50eb601…`→`4a309509…` | pol275 inventory seal |
| `.github/task12-install-289/pol109-workspace-proof.cjs` | 清单摘要 `a9214ab0…`→`a56377b0…` | 289 pol109 入口的清单自校验 |
| `.github/task12-install-290/pol109-workspace-proof.cjs.patch` | patch 预像行 `a9214ab0…`→`a56377b0…`（结果行 `ede07410…` 不变） | 290 pol109 以 289 proof 为 base；已验证 patch 结果 sha 仍等于 profile 的 `resultSha256 04281db7…` |
| `.github/task12-install-290/profile.json` | `pol109Assembly.inputs['workspace-proof.cjs'].baseSha256/patchSha256` 更新为 `1c64a76a…`/`a6f6f0a0…`；`workspaceBaseSha256` `a9214ab0…`→`a56377b0…`；`workspaceSha256` → `e198d2fd…`（按新清单+现有 14 条 delta 重算） | 290 pol109 的 base/结果 pin；**这是 290 的 pin，但只随 289 清单文件与 proof 的字节变化而变化，不涉及 grants 以外的产品语义** |
| `.github/task12-install-295/contract-finance/stage-pol109.py` | 289 proof 摘要锚点 `a9214ab0…`→`a56377b0…` | 295 链读取 289 proof 并在运行时替换；不是 323 账本/材料 pin |

未改 `.github/task12-install-295` 的账本/材料 pin（`0139b46a…`/`98e016b2…` 等仍为 323 重钉值），也未改 290 的 `originals`/`indexRows`/其它 assembly pin。

## 4. 验证结果

| 检查 | 结果 |
| --- | --- |
| 8 份清单 JSON 解析 + grants 行 == 当前文件 sha | 全部 **OK**（`0e67f983…`） |
| `git diff --numstat` | 8 份均 `1 1`（只改一行） |
| seal 一致性（settlement 6 + pol275 1 + pol109 proof 1） | 全部 **True** |
| 290 proof patch 结果 | 应用到新 289 proof 成功，结果 sha = `04281db7…`（profile `resultSha256` 不变） |
| `pnpm check:migration-baseline` | `status: clean`（323 / `20261119007500…` / `98e016b2…`） |
| `docker ps -q` | 见第 6 节实测 |

## 5. 未能完整跑通的入口与原因

- **289 `run.sh` 各模式**（settlement/template/draft/pol108/pol109/pol275 等）：CI 在存在 `.github/task12-install-290/profile.json` 时会走 290 分支，289 `run.sh` 为历史备用；且 289 清单是历史快照，当前 HEAD 的实际 workspace 仍有大量与 grants 无关的漂移（实测 settlement 模式：90 个文件 hash 不同、69 个新增文件未在清单；pol109：111 个不同、72 个新增）。因此这些入口在当前 HEAD 上不是「只差 grants 一行」，无法以本轮回执声称跑绿；本轮只对 line-l 指定的 grants 摘要负责。
- **290 pol109**：模拟其 host 侧步骤（archive + 2 个 prisma base 覆盖 + 4 个 fixture + 289 proof）后，两个 workspace patch 的 base/delta/result pin 均通过；`workspaceBaseSha256`/proof patch 结果 pin 通过。但完整 `290/run.sh pol109` 还依赖 `produce.py` 运行时重生成 `289/installer.cjs`（其 base pin 与工作树里的静态 289 installer 不同），本轮未执行 produce.py 与 Docker 构建，故未声称整条 lane 通过。
- **289 pol109/pol275 入口**：同上，受历史快照漂移影响，无法在当前 HEAD 完整跑绿。

## 6. 资源清理实测

```
$ docker ps -q
2eb4dd22cedd
$ docker ps --format '{{.Names}} {{.Label "org.jiangkong.contract-finance.source-sha"}}'
competent_cori 5d07c92c05ed2990217deaba934a71c1f530c51e
```

过程实测：重钉进行中曾观测到另一个并发 lane 的 `contract-finance` 容器在跑（`competent_cori`，label source-sha `5d07c92c…`，非本工作树 `81338119c`，非本轮启动），如实记录、未去停他人容器；本轮**未启动任何容器**（289 清单重钉是纯文本/摘要操作）。

收尾实测（并发 lane 结束后）：

```
$ docker ps -q
$ docker ps -q | wc -l
0
```

即**最终为空（0）**。
