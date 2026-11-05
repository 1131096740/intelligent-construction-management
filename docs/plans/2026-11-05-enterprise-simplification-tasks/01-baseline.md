# 01：固定现状与受控公开验收入口

**状态：** `plan-confirmed` / `prepared-complete` / `github-close-pending`；按用户确认的 `--prepare / --verify` 及输出清单边界，任务01准备产物完成；GitHub待主控最终新SHA编排及重封包后收口，真实运行仍NOT RUN。本轮用户已授权整套实施及 GitHub 工单推进；[#383](https://github.com/1131096740/intelligent-construction-management/issues/383) 已发布，归属父工单 [#382](https://github.com/1131096740/intelligent-construction-management/issues/382)。迁移、受控实验、部署与生产变更仍按各自具体授权执行。 当前起步与阻断见[集成交接](../../progress/2026-11-05-enterprise-simplification-integration-start.md)。

**类型：** 验证前置片。目标为一个新会话可完成的边界；如果探索发现仍跨越多个独立用户路径，应先收窄票据再执行。

**交付行为：** 形成可复核的源码、Schema、迁移、运行角色与真实数据保留基线；为随后每片提供可运行的公开HTTP/PG/Web验收入口，不启动未获准的实验。

**Blocked by：** 无（仅表示图中无前置，不代表已获实施授权）。

**需求：** BAS-01。以[完整规格](../../specs/2026-11-05-enterprise-simplification-spec.md)最终规则为准，不能只实现票据标题。

**技术决定：** [技术方案](../2026-11-05-enterprise-simplification-technical-plan.md) D01、D10。**公开验收：** [验收情景](../2026-11-05-enterprise-simplification-acceptance.md) A16、A36、A38。

## 验收条件

> 以下勾选仅表示本验证前置票的**准备产物**已核齐，原验收条目正文不变。栈/真实Web复用指针、源码/迁移/保留基线、受控资源/权限/故障及清理的输入合同和停止条件见[准备产物交接](../../progress/2026-11-05-enterprise-simplification-task01-prepared.md)；不表示真实HTTP/PG/Web、ACL/TLS、迁移或清理已运行。未知来源和数据未核项仍如实保留，独立授权后验及任务16/42/44真实门不豁免。

- [x] BAS-01：Vue 3、TypeScript、TDesign 与 --jg-*；NestJS、PostgreSQL；通过电脑、手机浏览器及微信链接使用；不新建 App、小程序或通用工作流/低代码平台。
- [x] 记录混合工作区归属与指纹，既有修改完整保留；核146与244迁移来源/校验值及实际部署差距，不直接合并迁移目录。
- [x] 固定一次性资源身份、依赖、受限角色、故障入口、超时与按身份清理；现有失败关闭门保持，未获实验授权不启动资源。
- [x] 形成资金提交问题复现/修复验证所需入口及停止条件；既有通过/失败/未执行分别登记。

## 验证与边界

- 业务片贯穿需要的Schema/约束、领域公开API、页面与真实行为测试；既有层无需改动时说明复用证据，不能为形式齐全改无关层。验证前置/技术验证/发布准备片以其可核验产物验收。
- 金额、权限、状态、文书、归档、审计用后端公开行为验证；最窄检查通过后做受影响包typecheck/lint，Web另做check:ui。依赖外部网关时明确模拟与真实边界。
- 保留真实数据及既有未提交内容；本票不包括无关清理、生产变更、重启/删除状态不明旧资源。受控实验/迁移/远程写须在实际实施时按项目既有授权流程处理。
- 完成时提供可复核行为、指纹/检查结果和未通过事项，更新简短进度；不能把旧SHA收据或文档确认作为本票通过。
