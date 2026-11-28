# 任务06本地中央整合收据

中央分支 `codex/enterprise-simplification-integration-20261105-r2`，准确合并 `e5e70bfd6fba6c8f3769ac6e3f0ebb73a01ed449`；候选 `2a54a5819a25ee9da56d690663466936af2ba080`。两者 tree 均为 `a8b427d7b6a7eb3b1bae88cb62bb9b162814626d`。合并前中央 `0f83aa83ba8b9372499aadcb4e6d27ef8067e7c7` 及候选均干净，祖先/40文件非空差分/文件和原证据哈希核对通过；正式 escalation 后仅 `git merge --no-ff` 成功，无冲突。合并后仍干净。

## 实际中央验证

- Node20.20.2、pnpm9.15.9。API5套222/222，Web2文件101/101，均0失败/跳过；共享build、API类型/lint/fresh build、Web类型/lint/UI与E2E类型全部exit0。
- fresh实际Nest metadata后原7write与7check（支持者require-ready）、contractMutation与静态编排369/369全部通过；703路由、657wrapper/696绑定、397动作/0阻塞，86退役保护、contractMutation80。没有改checker/预算或全局测试DB跳过。
- 当前候选24浏览器/0skip/0retry、桌面1366×768和touch390×844证据按完整同tree继承，本整合未盲目重跑。旧112浏览器及6文件130项Web仅绑定9f，不包装为新SHA全量通过。API222在中央实际重跑。

## 新源码packet

`/private/tmp/jg-task06-integrated-source-packet-e5e70bfd-20261106.json`，prepare/verify均exit0；3107文件/198迁移源码；seal `bd6dc7959381f80eadc951f12d4b78374200d76f55b120b9f69d42fe556f7c1a`；packet SHA-256 `6e09b4d587add127437ae6a004b991d5dbabbfb5c88e4454662034649ec64ce3`。只证明准确mergeSHA的源码成员、干净树和字节，ignored构建/已装依赖闭包未封存。

## 准备和限制

PG仅既有 --validate-manifest/--list静态库存，524逻辑项（CI523+manual1），全部PREPARED_NOT_EXECUTED；198是迁移源码数，未应用迁移。16/42/44真实门保持。生产全局鉴权/真实PG约束竞争/物理手机/真实网关与PDF成功不由本收据证明；细项按JSON继承原边界。

原263 Spec P2/Standards P3与公开RED、旧93/15失败、20skip/浏览器sandbox失败等日志及hash全部保留；新两轴准确2a54各0。未改原报告。

未改PROGRESS，未追加文档commit、推送、GitHub/main合并/关票、远端CI、PG/SQL/迁移/Docker/driver/资源helper、真实短信/银行/存储、部署或生产。原dirty根未业务读取、复用或写入。自有检查进程已退出，未开服务器、创建资源或留下held request。

## 每条检查命令

| 步骤 | 命令 | exit | 日志 SHA-256 |
|---|---|---:|---|
| shared-build | `pnpm --filter @jiangkong/shared-domain build` | 0 | `30c97b9af1bd31e415311e473cea0923339c93248dd7650447da9b7e7783900c` |
| api-typecheck | `pnpm --filter @jiangkong/api typecheck` | 0 | `8ca8c9b9a8310f6093ad512d2415aa3dc166c88280612323b251af25622fcbf0` |
| api-lint | `pnpm --filter @jiangkong/api lint` | 0 | `111d90ebe5f95ef9f068b6c2129dc8c5cfa2bf7de4ed4173d7644f87b8470f3e` |
| api-build | `pnpm --filter @jiangkong/api build` | 0 | `519439e216c0eb9963f155be9b49e5d8c18e34fb98620f4d6ac072e4237d56fe` |
| web-admin-typecheck | `pnpm --filter @jiangkong/web-admin typecheck` | 0 | `5db1120f0bb73e7c92eb0d79bb892ce02bb13a8e7ba3467b15dcfa958235b974` |
| web-admin-lint | `pnpm --filter @jiangkong/web-admin lint` | 0 | `1d9580d3fac776f7b3cf4faca4bbeb1ea25f12f8d24786b65105705d1ff807c8` |
| web-admin-check-ui | `pnpm --filter @jiangkong/web-admin check:ui` | 0 | `78c9db335a37105694a88beb96737b3e9f9fd0da365aff8d918a9f479ecbc1d0` |
| api-narrow-222 | `pnpm --filter @jiangkong/api exec jest --runInBand --runTestsByPath src/contract-bill/contract-bill-excel.service.spec.ts src/contract-bill/contract-bill.service.spec.ts src/contract-workbench/dto/contract-draft-aggregate.dto.spec.ts src/contract-workbench/contract-draft.controller.spec.ts src/contract-workbench/contract-draft-aggregate.service.spec.ts` | 0 | `f789fa0437f948975dc1e21cdbe475850bc61e1084ce8a597cf8ffa60c5dcd85` |
| web-narrow-101 | `pnpm --filter @jiangkong/web-admin exec vitest run src/pages/contracts/workbench/ContractBillFocusEditor.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts` | 0 | `14df26836d8b9915d472c309b6823aa9238ddf0fc686528ecc2e0a4cd268a328` |
| web-e2e-types | `pnpm --filter @jiangkong/web-admin typecheck:e2e` | 0 | `c5f9079df7ab75df0dddb1b81e4bd8f3857df44ae48ba69aff71996bb1c0ccfc` |
| governance-inspect-whole-site-capabilities-write | `node scripts/inspect-whole-site-capabilities.mjs --write` | 0 | `1b6251a7184f092580c6cfd0d202a59bfb3b8e9a63f4d524148d54795bc60c5c` |
| governance-inspect-whole-site-web-api-manifest-write | `node scripts/inspect-whole-site-web-api-manifest.mjs --write` | 0 | `a0d79bfdb14839d649b0dba3e2679247c15e11944a499d7bce7af198f7d9e1bb` |
| governance-inspect-whole-site-page-action-manifest-write | `node scripts/inspect-whole-site-page-action-manifest.mjs --write` | 0 | `7b16dc9326240c4bbe35ed0fda5ede7a035d3144ffb62ddaf46855f114cd2ad3` |
| governance-inspect-whole-site-route-usage-manifest-write | `node scripts/inspect-whole-site-route-usage-manifest.mjs --write` | 0 | `fdf9fbc8b93313f5b0f591d8c4830b5e8a64da2a5176c5ac71b976fcc5519954` |
| governance-inspect-whole-site-capability-matrix-write | `node scripts/inspect-whole-site-capability-matrix.mjs --write` | 0 | `1b9569142752f142f04008bb658d3838e065e68377f3135a4e823f335bd21452` |
| governance-inspect-user-fill-entry-inventory-write | `node scripts/inspect-user-fill-entry-inventory.mjs --write` | 0 | `21f24208c0c3700e2d7fec8aedbd16b427c26b33cb5c30ed5b642f6cb761bc0a` |
| governance-inspect-contract-mutation-authority-manifest-write | `node scripts/inspect-contract-mutation-authority-manifest.mjs --write` | 0 | `f3a1dd7f22ee543f8634a43832e20a051dfcf34beb3ed458716c649d1c0deac7` |
| governance-inspect-whole-site-capabilities-check | `node scripts/inspect-whole-site-capabilities.mjs --check` | 0 | `d6ca41283cf1da8896fe0bb0c9c8c3b7fda587352cb945fd44e42a31c2bceb9a` |
| governance-inspect-whole-site-web-api-manifest-check | `node scripts/inspect-whole-site-web-api-manifest.mjs --check --require-ready` | 0 | `411cf04b9f82d8ac6ea1a22835ef1e72002cb9a3c2b6a95f32144bb4b380ca35` |
| governance-inspect-whole-site-page-action-manifest-check | `node scripts/inspect-whole-site-page-action-manifest.mjs --check --require-ready` | 0 | `e83a8dc539e8d8c43388d8b0523cf1233baf955abad3d493d2d87f2325443afe` |
| governance-inspect-whole-site-route-usage-manifest-check | `node scripts/inspect-whole-site-route-usage-manifest.mjs --check --require-ready` | 0 | `23256aea9f1e0ebf84f3cd97f58ce71f27b601cd9b2e7196680074fb78072423` |
| governance-inspect-whole-site-capability-matrix-check | `node scripts/inspect-whole-site-capability-matrix.mjs --check --require-ready` | 0 | `57e8a198a22cd5a70bd559fe53af4f5fb6877375b24feb2eed6079b2af9fd28a` |
| governance-inspect-user-fill-entry-inventory-check | `node scripts/inspect-user-fill-entry-inventory.mjs --check --require-ready` | 0 | `1d2c1e0913ee0ad64ee6ec37839d23f3c2eea158975e4b378e8049f09c198422` |
| governance-inspect-contract-mutation-authority-manifest-check | `node scripts/inspect-contract-mutation-authority-manifest.mjs --check` | 0 | `66016a134f8399a9294a62d9e52508f5d7f17a1c4ba74eba6eb491ebee246ce4` |
| governance-ci-orchestration | `pnpm test:ci-orchestration` | 0 | `e38cfec0c103240a0a3670ef5ee938e6502c5e747db999b2411b7d7a2269e83e` |
| source-prepare | `node scripts/prepare-enterprise-acceptance.cjs --prepare --output /private/tmp/jg-task06-integrated-source-packet-e5e70bfd-20261106.json` | 0 | `ad16084b4c5d3ccdd05062365c623b52414f4289188baac19b6833e5f10e09e6` |
| source-verify | `node scripts/prepare-enterprise-acceptance.cjs --verify /private/tmp/jg-task06-integrated-source-packet-e5e70bfd-20261106.json` | 0 | `28944266b63f12c29bec5b297f2e4f4a5d457d9341d92d66245b74a2130b5ecf` |
| PG静态 | `node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest` | 0 | `23a481ac3dbbbb3039921820e24ff230448124b57836f446e1b43f68e3f6e09c` |
| PG静态 | `node services/api/prisma/run-database-dynamic-gate-local.cjs --list` | 0 | `3055397fbaf6bd681f94b2b62088b0bb2f98edaa70d9f5217f20f3d0d35e9213` |

每条日志路径与完整JSON参数、旧失败和边界：`/private/tmp/jg-enterprise-task06-integrated-merge-20261106.json`（SHA-256 `8cd1679baf4080f09715c4d4346e9905ac20690fc70e701f7a008c84e6a09b42`）。
