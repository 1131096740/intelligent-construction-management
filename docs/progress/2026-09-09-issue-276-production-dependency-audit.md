# Issue #276 生产依赖安全审计与最小修复

## 范围与基线

- Issue：#276（POL-DEPS-SEC），父票 #93；只解除 #275 的生产依赖审计前置，不实现或关闭 #275/#108。
- 唯一候选基线：`1fc3355a89db66785a9815f7e47df58d44a4293e`。
- 运行时：Node `v20.20.2`、pnpm `9.15.9`。
- 基线 `pnpm audit --prod --json`：退出 1；21 个 advisory、23 个漏洞实例，`15 high / 7 moderate / 1 low / 0 critical`。
- 基线命令原始输出 SHA-256 `b39a12206630e5a7ea5a519922aaed330736fad20d00623022ff311358ecf28d`；语义等价的格式化归档为 [2026-09-09-issue-276-production-dependency-audit-baseline.json](2026-09-09-issue-276-production-dependency-audit-baseline.json)，归档 SHA-256 `3d1a0b3e6e2a6b6217c26d14c54970d8ff4ceb49418980d238095fb5fdbd000f`。格式化会改变空白与字节哈希，因此两者不互称字节副本。
- 命令原始输出与格式化归档均只包含包、版本、依赖路径、公告和统计，不含 token、连接信息、本地路径或生产信息。

## Advisory 与依赖路径

下表的“基线解析/路径”来自同一独立候选的 `pnpm why` 与 audit findings；“修复依据”来自每项 GitHub Advisory 的 patched versions。XML 公告虽然有三项在 `0.9.11` 已修复，为一次覆盖同包全部 13 项，候选统一采用最小共同安全版本 `0.9.12`。

| Advisory | 严重度 | 基线解析 / pnpm why 路径 | 实际影响接缝 | 上游修复依据 | 最小候选 |
| --- | --- | --- | --- | --- | --- |
| [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) | moderate | `@nestjs/core@10.4.22`；API 直接依赖并由 `@nestjs/platform-express@10.4.22` peer 引入 | SSE 输出字段注入；当前 `services/api/src` 无 `@Sse`、`SseStream` 或 `text/event-stream` 接缝 | `>=11.1.18` | 非阻断残余，见下文 |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | moderate × 2 | `qs@6.15.2/6.15.3`；Nest platform → Express/body-parser → qs | API 查询串与 body 解析 | `>=6.16.0` | `qs@6.16.0` |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | moderate × 2 | `qs@6.15.2/6.15.3`；同上 | API 查询串与 body 解析 | `>=6.16.0` | `qs@6.16.0` |
| [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6) | moderate | `@xmldom/xmldom@0.9.10`；API → `docxtemplater@3.69.0` → xmldom | 合同 DOCX 模板 XML 渲染 | `>=0.9.12` | `0.9.12` |
| [GHSA-6mj3-qw4j-hgrw](https://github.com/advisories/GHSA-6mj3-qw4j-hgrw) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-g53g-w8rj-fmg7](https://github.com/advisories/GHSA-g53g-w8rj-fmg7) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.11` | `0.9.12` |
| [GHSA-w2rr-34g9-rvrj](https://github.com/advisories/GHSA-w2rr-34g9-rvrj) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.11` | `0.9.12` |
| [GHSA-4w3w-2rp5-g8jm](https://github.com/advisories/GHSA-4w3w-2rp5-g8jm) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.11` | `0.9.12` |
| [GHSA-c7q8-3ch8-vqpv](https://github.com/advisories/GHSA-c7q8-3ch8-vqpv) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-27p8-2357-5qqv](https://github.com/advisories/GHSA-27p8-2357-5qqv) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-3px3-54cx-rmw9](https://github.com/advisories/GHSA-3px3-54cx-rmw9) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-vr34-hp96-76pp](https://github.com/advisories/GHSA-vr34-hp96-76pp) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-6h8r-xr42-gp59](https://github.com/advisories/GHSA-6h8r-xr42-gp59) | moderate | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-8344-3jmq-59r6](https://github.com/advisories/GHSA-8344-3jmq-59r6) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-965w-775f-mr7g](https://github.com/advisories/GHSA-965w-775f-mr7g) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9) | high | `@xmldom/xmldom@0.9.10`；同上 | 同上 | `>=0.9.12` | `0.9.12` |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | high | API 直接依赖 `sharp@0.35.3` | 零星采购收货照片真实解码与水印；私有图像附件进入 DOCX | `>=0.35.4`，预编译包携带 libheif 1.23.2 | `sharp@0.35.4` |
| [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) | high | Nest platform → `multer@2.2.0` | 全部 `FileInterceptor` 私有上传路由 | `>=2.3.0` | `multer@2.3.0` |
| [GHSA-qfvm-cv95-jqjf](https://github.com/advisories/GHSA-qfvm-cv95-jqjf) | high | Nest platform → `multer@2.2.0` | 同上 | `>=2.3.0` | `multer@2.3.0` |
| [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72) | low | Nest platform → `multer@2.2.0` | 同上 | `>=2.3.0` | `multer@2.3.0` |
| [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4) | high | Nest platform → `multer@2.2.0` | 同上 | `>=2.3.0` | `multer@2.3.0` |

## 候选方案与残余

- 根 overrides 固定 `@xmldom/xmldom@0.9.12`、`multer@2.3.0`、`qs@6.16.0`；API 直接依赖最低版本提升为 `sharp^0.35.4`，并由锁文件固定实际解析。
- 修复后 `pnpm why` 只解析到上述四个安全版本；Sharp 运行时版本为 `sharp 0.35.4 / libvips 8.18.6 / heif 1.23.2`。
- 修复后正式 `pnpm audit --prod --audit-level high` 退出 0；全量 `pnpm audit --prod --json` 只剩 1 个 moderate，`0 high / 0 low / 0 critical`。
- 候选命令原始输出 SHA-256 `defdfed5dda0442a28ca9dcac72dd623ccaf61b7501f47268d5d11786ce35be5`；语义等价的格式化归档为 [2026-09-09-issue-276-production-dependency-audit-candidate.json](2026-09-09-issue-276-production-dependency-audit-candidate.json)，归档 SHA-256 `d8b6775a45ca09bdbcc1d9b431f6799f86641fcb6f71a647f5723e4c7379fc88`。两组哈希分别留账。
- 唯一残余 GHSA-36xv-jgw5-4q75 只在 Nest `11.1.18` 修复。Nest 官方 v10→v11 迁移同时切换 Express 5，并改变路由匹配、查询参数解析、模块解析、生命周期和中间件顺序；仓库当前是成套 Nest 10 + Express 4，不能在依赖补丁票中只 override 一个 peer 或暗中吸收框架迁移。当前代码又没有公告要求的 SSE 接缝，因此它如实登记为非阻断 moderate，而非忽略项或“零漏洞”声明。后续若升级 Nest，必须作为独立框架兼容范围成套设计与验证。

## RED → GREEN 与回归

- RED：live-main 基线 full production audit 退出 1，元数据含 15 high。
- GREEN：同一候选、同一生产依赖集合的正式 high 阈值 audit 退出 0，仅报告 1 moderate。
- frozen lockfile install：Node 20 / pnpm 9.15.9 下通过。
- 受影响公开接缝：合同 DOCX 渲染、抽取、图片附件追加与处理器；零星采购照片水印及上传；通用私有文件 controller/service，共 8 suites / 394 tests 通过。
- API typecheck、lint、build 通过。最终 exact-SHA 的完整 `release:local`、disposable PostgreSQL 16、官方 manifests、P0/RC-06 浏览器门、双轴审查和 GitHub CI 以 #276 最终交付回执为准。

## 边界

未修改 Schema、migration、权限、金额、事务、数据归属或业务语义；未降低审计阈值、未增加 ignore/mute、未重分类依赖或删除功能。未连接、扫描或写入生产，未部署、未执行生产 migration/COS/activation/rollback。
