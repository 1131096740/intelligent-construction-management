# NTF-05 短信模板口径收口（2026-11-19 决定）

2026-11-22。纯文档收口，未改代码、Schema、迁移或运行时行为。

## 变更

- `docs/specs/2026-11-05-enterprise-simplification-spec.md` 的 NTF-05 由「短信包含固定可点击 HTTPS 首页链接」改为「纯文字通用模板，正文无链接、无参数，仅提示登录后查看待办；站内链接按登录身份鉴权，登录后按权限查看详情」。
- `docs/plans/2026-11-05-enterprise-simplification-tasks/37-notifications.md` 的 NTF-05 验收条同步为同一口径（原条目已按 2026-11-19 决定书写，本次补齐「站内链接鉴权」表述）。

## 依据

2026-11-19 用户确认采用已审核的纯文字通用模板。实现侧一致：`services/api/src/approval/approval-sms.service.ts` 只使用 `APPROVAL_SMS_GENERIC_TEMPLATE_ID`，请求体 `TemplateParamSet: []`，正文不含链接或业务参数；可点击入口只存在于登录后的站内待办。既有对照口径见 `docs/runbooks/approval-progress-sms.md`、`docs/plans/2026-11-05-enterprise-simplification-technical-plan.md` D09、`docs/plans/2026-11-05-enterprise-simplification-acceptance.md` A30/A31。

本收据只统一文档口径，不构成短信真实送达证据；真实送达、供应商受理与手机送达的举证边界仍按 #419 保持分别记录。
