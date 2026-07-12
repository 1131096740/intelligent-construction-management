# Stage B Safe User Creation Plan

**Goal:** 为真实试运行补齐受控的人员开户入口；开户与授岗分离，新人员必须首次改密，且失败时不留下半成品用户或权限记录。

## Backend

- 新增仅 global `super_admin` 可调用的 `POST /organization/users`。
- 输入只允许姓名、中国大陆手机号、启用部门、临时密码与确认密码；`isActive=true`、`mustChangePassword=true` 由服务端固定。
- 密码按现有认证强度校验并统一 bcrypt 哈希；明文不得进入日志、审计详情或响应。
- Serializable 事务内再次确认操作者仍启用且持有规范 global `super_admin`，并确认部门仍启用；创建用户与 `permission.user.create` 审计同事务。
- 新用户初始零 `UserPosition`、零 `ProjectMember`；后续必须使用现有授岗预览/密码确认/apply 流程。
- 手机号唯一冲突、序列化冲突和部门/操作者状态漂移返回固定中文业务错误；任一步失败零用户、零角色、零审计。

## Web

- 组织管理页增加独立“新增人员”抽屉；使用 Web Crypto 本地生成高熵临时密码，默认遮罩，可显隐、复制和重新生成。
- 密码不进入 URL、localStorage、持久 store 或日志；成功、失败和关闭均清空密码字段。
- 提交成功后只刷新真实目录，不乐观插入；明确提示“人员已创建但尚未授岗”，继续使用现有单人授岗流程。

## Verification

- API：字段白名单、密码强度/确认、global super_admin 二次确认、启用部门、手机号并发唯一、事务原子性、零初始角色、审计脱敏。
- Web：密码生成/清理/复制边界、请求白名单、失败不残留、成功刷新、不自动授岗。
- 运行 API/Web targeted tests、typecheck、lint、Web `check:ui`/build 与独立复审。
