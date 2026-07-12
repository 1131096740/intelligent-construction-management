# Stage C Template Version Governance Plan

**Goal:** 让合同模板配置模式基于真实模板详情和版本状态工作，消除手填 `versionId`，把“已发布不可覆盖、只能克隆新草稿”落实为可理解交互。

## Backend

- 新增/补齐模板详情只读 endpoint：模板主信息 + 全部版本，按 versionNo 倒序；每版返回状态、五类 schema、创建/提交/发布信息。
- 模板不存在固定中文 404；只读不写审计/版本。
- 保持既有草稿可编辑、submitted 仅发布、published 只读/克隆规则，不放宽 service。

## Web

- 编辑页从 route templateId 读取详情；默认选最新 draft，否则最新 published，再否则第一版。
- 版本下拉展示版本号/状态；draft 显示保存+提交，submitted 只显示发布，published 只读且只开放克隆。
- 克隆成功自动刷新详情并选中新草稿；页面不再出现可编辑 versionId。
- runtime 状态/版本缺失 fail closed，不从 URL/输入伪造。

## Verification

- API service/controller，Web API/config/structure TDD；API/Web typecheck/lint，Web check:ui/build，独立复审。
