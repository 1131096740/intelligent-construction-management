# 生产 API 回环监听硬化 Implementation Plan

**Goal:** 让 API 在未配置 `HOST` 时默认只监听 `127.0.0.1`，消除生产 Node 进程监听 `*:3000` 的防御纵深缺口，同时保留显式 `HOST` 覆盖供确有需要的运行环境使用。

**Architecture:** 在现有纯函数 `listenApi` 的唯一缺省分支收紧监听地址，不修改 Nginx、systemd、端口、健康检查或部署流程。显式非空 `HOST` 继续原样 trim 后传给 Nest；需要容器或局域网监听的环境必须明确设置 `HOST=0.0.0.0`。生产 Nginx 和健康检查均已使用 `127.0.0.1:3000`，与该默认值兼容。

## Constraints

- 严格 TDD，先修改 `api-listen.spec.ts` 得到有效 RED。
- 不硬编码生产 IP，不修改密钥、环境文件或服务器。
- 不推送、合并、部署或重启生产服务。
- 显式 `HOST=0.0.0.0`、`HOST=::`、`HOST=127.0.0.1` 继续被尊重。
- 空白或缺失 `HOST` 必须统一收紧为 `127.0.0.1`。

### Task 1: 收紧缺省监听地址

**Files:**
- Modify: `services/api/src/api-listen.spec.ts`
- Modify: `services/api/src/api-listen.ts`
- Modify: `PROGRESS.md`

- [ ] 将旧“空 HOST 保持 Nest 默认”的测试改为断言 `app.listen(3000, "127.0.0.1")`，同时补显式 `0.0.0.0` 不被改写的回归。
- [ ] 运行聚焦 Jest 并确认 RED 精确来自空 HOST 仍只传 port。
- [ ] 最小修改 `listenApi`：`const host = rawHost?.trim() || "127.0.0.1"`，始终以 port+host 调用 Nest。
- [ ] 运行聚焦 Jest、API typecheck、lint、business-errors、build、`git diff --check`。
- [ ] 更新 `PROGRESS.md`：记录本地硬化完成、生产仍运行旧 SHA 且尚未部署，必须经授权发布后再 SSH 复验 `127.0.0.1:3000` 和公网 3000 不可达。
- [ ] 提交：`fix: 收紧 API 默认监听地址`。
