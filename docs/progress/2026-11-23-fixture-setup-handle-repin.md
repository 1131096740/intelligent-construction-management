# staged fixture `getStagedSetupHandle()` 增量后的 pin 重钉回执

- 日期：2026-11-23
- 工作树 `/tmp/jgP`，分支 `line-p-repin-fixture`，基线 `797515133`
- 触发：line-l 在 `a29604ca1`（`feat(ci): staged fixture 增量子句柄`）给共用 staged fixture 增加只读 `getStagedSetupHandle(database)`，既有行为不变；两个文件的字节变化使一批 pin 失效。未 push、未动票、未动其它工作树。

## 1. 来源核对（先算，后改）

| 文件 | 旧 sha256 | 新 sha256 | 来源 |
| --- | --- | --- | --- |
| `services/api/prisma/local-staged-migrations.cjs` | `7240ec8d0712c9c8f62d898b1af9885837cbb7ecba85e161f842ad0f69eecba7` | `6f01cf285dc36ceb980e871319b79015584ba0d23a6c765f1b3c70941c46b674` | `git show a29604ca1^:` = 旧值；当前工作树 = 新值（`a29604ca1` 的 451 行新增 `getStagedSetupHandle`） |
| `services/api/prisma/local-staged-ci-dynamic.cjs` | `bc1f6bb3fe0d8c00722f05eb2455c868142ca058a3110bac96eaf35f06a571da` | `d67994ab98afdaf55fa6c2a70ee0673e93178fa15cfea406d1a1e744ae8f2ad6` | 同上（`a29604ca1` 7 行增量接线） |

`a29604ca1^` 两个文件的 hash 与失效清单里的旧值逐一相等，确认来源不是别的副本。

## 2. 8 份 289 清单（每份只改这两行）

旧行 → 新行（两者均 `1 1` 行变更，其余字段不变）：

| 清单 | 行数 | 改后文件 sha256 |
| --- | ---: | --- |
| `.github/task12-install-289/workspace-inputs.json` | 2536 | `adcefa3b…`（完整值见提交） |
| `draft-workspace-inputs.json` | 2536 | `b75aedee…` |
| `template-workspace-inputs.json` | 2536 | `55a90cf9…` |
| `pol108-core-workspace-inputs.json` | 2537 | `b6bc87ac…` |
| `pol108-scale-workspace-inputs.json` | 2537 | `4307ac3a…` |
| `invoice-workspace-inputs.json` | 2536 | `6d7faea4…` |
| `pol109-workspace-inputs.json` | 3684 | `d7b56dac…` |
| `pol275/workspace-inputs.json` | 2537 | `1376546f…` |

每份清单中两行的新值 = 当前源码文件 sha256；`procurement/workspace-inputs.json`（11 行，另一种清单）不钉这两个文件，未改。

## 3. 采购计划与 pins（295 `PROCUREMENT_295_ORIGINAL_OVERLAY_PIN` 的原因与修复）

- `295/.../procurement/stage-procurement295.py` 的原逻辑：计划清单行 == 当前 workspace → 跳过；否则必须在 `candidate-delta320.json` 或 `290/procurement/pins.json` 的 `overlays` 中有声明，否则 `OVERLAY_PIN`。
- 这两个 fixture 既不在 delta、也不在 overlays，之前靠「计划行 == 当前源码」通过；line-l 改字节后计划行仍是旧值 → 正是 `PROCUREMENT_295_ORIGINAL_OVERLAY_PIN`。
- 修复：把两份 `290/procurement/plans/{general16,project11}/source-inputs.json.gz` 中这两行更新为当前源码 hash（其余 3502/3503 行保持历史基线，不改语义），重新 gzip；`pins.json[lane].runtime['source-inputs.json']` 更新为**解压后清单**的 sha256：

| lane | 解压清单新 sha256 | gz 文件 sha256（参考） |
| --- | --- | --- |
| general16 | `d87d82719b517871b161011ae666349a34e65b0f37fd8fe4941e78829a018e0d` | 见提交 |
| project11 | `f0b485a797786e2f305dd9420feccea2bde9eaa1ab795db7233546bb28f99443` | 见提交 |

- 核实：重序列化前的原始 JSON 用同一 `json.dumps(...,separators=(',',':'))` 重编码与原始解压字节完全一致（仅两行 hash 不同），未改变格式/字段。

## 4. 其它失效/派生 seal

| 文件 | 旧 → 新 | 说明 |
| --- | --- | --- |
| `289/settlement-workspace.sh`（6 个 seal） | 各清单文件 sha256 旧值 → 新值 | settlement/template/draft/pol108-core/pol108-scale/invoice 的清单自封 |
| `289/pol275/workspaces.sh` | `c50eb601…`→`1376546f…` | pol275 清单自封 |
| `289/pol109-workspace-proof.cjs` | `a9214ab0…`→`d7b56dac…` | 289 pol109 清单自校验 |
| `290/pol109-workspace-proof.cjs.patch` | patch 预像行同步；结果行 `ede07410…` 不变 | 结果文件 sha 仍为 profile `resultSha256 04281db7…` |
| `290/profile.json` | `pol109Assembly.inputs['workspace-proof.cjs'].baseSha256/patchSha256`、`workspaceBaseSha256`、`workspaceSha256` 按新字节重算 | 290 pol109 的 base/结果 pin |
| `295/.../stage-pol109.py` | 289 proof 摘要锚点 → `d7b56dac…` | 295 链读取 289 proof 的锚点，不是 323 账本 pin |
| `289/procurement/workspace-inputs.json` | `workspaceSha256` → `25e4ec13…`（按 workspace-files.json 3504 行 + 当前文件 hash 重算；`supportSha256` 复核不变） | `workspace-files.json` 本身是路径清单，字节未变；变的是其派生 seal |
| `289/procurement/preflight.cjs` | `acceptedManifest` → `3295fc67…`（新 `procurement/workspace-inputs.json` 文件 hash） | preflight 的清单自封 |

**核对后判定不失效、未改**：`289/review-manifest.json` 的 `files` 里 `overlay/.../local-staged-migrations.cjs` 钉的是历史 292 archive 副本 `2a1bb698…`，不是当前源码；其 `installerSha256` 与 `archiveSha256` 实测分别等于当前 `289/installer.cjs`（`86d62f55…`）与 `historical-install-inputs.tar.gz`（`48e553b4…`），`produce.py` 只校验 manifest 自摘要（`7bdc13ad…`）。fixture 增量不改变这些字节，故未改（如 CI 后续证明需要，请以实测报错为准再改）。

## 5. 采购入口实跑（host staging）

```
$ python3 stage-procurement295.py general16 /tmp/jgP /tmp/prep797/prepared/context/workspace /tmp/stgp3-general16 --current-320
{"lane": "general16", "candidateDriftPaths": 109, "runtimeWorkspaceOverlays": 10}   # rc=0
$ ... project11 ...
rc=0
```

不再出现 `PROCUREMENT_295_ORIGINAL_OVERLAY_PIN`，也不再出现 `PROCUREMENT_295_CANDIDATE_PIN`。

为使这两个入口在当前树真正跑通，除 line-l 给的清单外，`candidate-delta320.json` 还需 4 条 candidate 更新 + 6 条新增（均 `expected` = 计划行、`candidate` = 当前 workspace 实测 hash；来自 line-m #425 与 line-l ACL 后续产物）：

- 更新：`apps/web-admin/src/api/core-flow-read.api.ts`、`services/api/prisma/database-dynamic-gate-manifest.json`、`services/api/src/contract-template/template-management.test-support.ts`、`services/api/src/project/project-completion-public.spec.ts`
- 新增：`apps/web-admin/src/pages/contracts/contract-lifecycle-capability-gates.structure.test.ts`、`services/api/prisma/run-database-dynamic-gate-local.test.cjs`、`services/api/prisma/run-database-dynamic-remaining-local.cjs`、`services/api/scripts/business-zeroing-policy.cjs`、`services/api/src/payment/testing/registered-payment-execution.synthetic-db.ts`、`services/api/src/validation/task3-static-field-validation.spec.ts`

## 6. 其它验证

- `pnpm check:migration-baseline`：`status: clean`（323 / `20261119007500…` / `98e016b2…`；**323 账本 pin 未改**）。
- 8 份 289 清单：fixture 两行 == 当前源码 sha（全 OK）；JSON 可解析。
- task398_standard 复跑：见第 7 节。
- `docker ps -q`：见第 7 节。

## 7. task398_standard 与资源清理

```
$ BUILDX_CONFIG=/tmp/jg-buildx bash .github/task12-install-295/contract-finance/run-contract-adjacent-ci.sh 797515133 task398-standard --current-320
EXIT=0
... "cleanup":"POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT"
```

task398_standard lane **绿（EXIT=0）**，容器自清理。未跑完整 Docker 采购 lane；只做 host staging（与 CI 同一 `stage-procurement295.py` 入口），原因是 Docker 为串行独占资源且本轮验收目标是「不再因 OVERLAY_PIN 停下」。

`docker ps -q` 实测见提交时补记：

```
$ docker ps -q
$ docker ps -q | wc -l
0
```

- 未验证部分：完整 Docker 采购 lane（general16/project11 真库 16+11 用例）未跑，仅验证到 host staging 不再因 pin 停下；`review-manifest.json` 判定不失效（见第 4 节证据）。
