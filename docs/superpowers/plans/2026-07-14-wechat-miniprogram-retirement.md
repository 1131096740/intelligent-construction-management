# 微信小程序永久退出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 永久删除建工智管微信小程序客户端、微信身份登录和 `wxOpenid` 数据结构，同时完整保留手机 Web、手机号登录、共享待办审批接口和微信扫码打开普通网页的能力。

**Architecture:** 分两个独立生产单元实施。第一阶段只删除小程序和微信认证运行面，不修改数据库；生产验收通过后，第二阶段在非空数据为 0、最新备份和临时恢复库演练均通过的前提下，用独立事务迁移删除 `wxOpenid`。每个生产单元都有单独的本地验证、用户授权、发布、回滚和 `PROGRESS.md` 记录。

**Tech Stack:** Vue 3、TypeScript、TDesign Vue Next、Vite、NestJS、Jest、Vitest、Prisma 5、PostgreSQL 16、GitHub Actions、systemd、Nginx、腾讯云 Lighthouse。

---

## 0. 执行边界与当前基线

本计划依据已确认设计：

- `docs/superpowers/specs/2026-07-14-wechat-miniprogram-retirement-design.md`

计划编写时基线：

- 本地 `main`：`21455aff`，设计文档已提交。
- 本地 `main` 比 `origin/main` 领先 2 个文档提交。
- 小程序 19 个文件位于 `apps/miniprogram`，未进入生产部署主链。
- 微信登录运行入口只有 `AuthController.wxLogin → AuthService.wxLogin → fetchWxSession`。
- `MeService.getWorkItems`、Web `fetchWorkItems`、首页和审批中心属于共享能力，严禁删除。
- 当前仅授权编写计划；本计划不授权代码修改、生产连接、推送、迁移或部署。

实施开始时必须使用隔离工作树或候选分支，并重新读取 `PROGRESS.md`、`AGENTS.md` 和设计文档。不得假定上面的提交状态仍未变化。

## 1. 文件责任图

### 第一阶段：运行面退出

**删除：**

- `apps/miniprogram/README.md`
- `apps/miniprogram/app.js`
- `apps/miniprogram/app.json`
- `apps/miniprogram/app.wxss`
- `apps/miniprogram/pages/login/index.js`
- `apps/miniprogram/pages/login/index.json`
- `apps/miniprogram/pages/login/index.wxml`
- `apps/miniprogram/pages/login/index.wxss`
- `apps/miniprogram/pages/work-item-detail/index.js`
- `apps/miniprogram/pages/work-item-detail/index.json`
- `apps/miniprogram/pages/work-item-detail/index.wxml`
- `apps/miniprogram/pages/work-item-detail/index.wxss`
- `apps/miniprogram/pages/work-items/index.js`
- `apps/miniprogram/pages/work-items/index.json`
- `apps/miniprogram/pages/work-items/index.wxml`
- `apps/miniprogram/pages/work-items/index.wxss`
- `apps/miniprogram/project.config.json`
- `apps/miniprogram/sitemap.json`
- `apps/miniprogram/utils/api.js`
- `services/api/src/auth/dto/wx-login.dto.ts`

**修改：**

- `services/api/src/auth/auth.controller.ts`：删除 `/auth/wx-login` 路由。
- `services/api/src/auth/auth.service.ts`：删除微信身份登录和微信供应商会话逻辑。
- `services/api/src/auth/auth.service.spec.ts`：删除只验证已取消能力的 DTO 与服务测试，保留手机号认证回归。
- `apps/web-admin/src/pages/settings/system-governance-readonly.config.ts`：把“小程序登录”改为“手机网页登录”。
- `apps/web-admin/src/pages/settings/system-governance-readonly.config.test.ts`：锁定新的登录说明。

**创建：**

- `services/api/src/auth/auth.controller.spec.ts`：锁定允许的认证路由并阻止 `wx-login` 回归。
- `docs/superpowers/runbooks/2026-07-14-wechat-platform-retirement-checklist.md`：外部微信平台人工关闭清单，不包含任何密钥值。

**当前有效文档更新：**

- `AGENTS.md`
- `docs/design/建工智管_认证授权设计.md`
- `docs/design/web-admin-v2-enterprise-ui.md`
- `obsidian-current/建工智管_第一阶段MVP_产品与架构设计.md`
- `obsidian-current/建工智管_总览.md`
- `obsidian-current/建工智管_页面清单.md`
- `obsidian-current/建工智管_知识库总览.md`
- `obsidian-current/建工智管_权限系统.md`
- `obsidian-current/建工智管_上线就绪度.md`
- `obsidian-current/建工智管_技术栈详解.md`
- `obsidian-current/建工智管_云函数清单.md`
- `obsidian-current/建工智管_待改功能.md`
- `obsidian-current/建工智管_项目目标与开发规格.md`

日期化状态报告、历史迁移、历史计划与 Git 历史保持原样，只把仍作为当前真相使用的文档改为 Web 唯一客户端体系。

### 第二阶段：数据结构退出

**创建：**

- `services/api/prisma/migrations/20260714120000_wechat_identity_retirement/migration.sql`：事务内硬阻断非空数据并删除唯一索引和字段。
- `services/api/src/database/user-wx-openid-retirement-schema.spec.ts`：静态锁定迁移安全边界。
- `docs/progress/2026-07-14-wechat-miniprogram-retirement-release.md`：记录两次生产发布的实际证据。

**修改：**

- `services/api/prisma/schema.prisma`：删除 `User.wxOpenid`。
- `PROGRESS.md`：分别记录第一阶段候选、第一阶段生产验收、第二阶段备份演练和正式迁移结果。

## 2. 第一阶段：删除微信认证运行入口

### Task 1：用路由回归测试驱动 API 清理

**Files:**

- Create: `services/api/src/auth/auth.controller.spec.ts`
- Modify: `services/api/src/auth/auth.controller.ts`
- Modify: `services/api/src/auth/auth.service.ts`
- Modify: `services/api/src/auth/auth.service.spec.ts`
- Delete: `services/api/src/auth/dto/wx-login.dto.ts`

- [ ] **Step 1：先新增会失败的认证路由测试**

创建 `services/api/src/auth/auth.controller.spec.ts`：

```ts
import { PATH_METADATA } from "@nestjs/common/constants";
import { AuthController } from "./auth.controller";

function authRoutePaths() {
  return Object.getOwnPropertyNames(AuthController.prototype)
    .filter((name) => name !== "constructor")
    .map((name) => Object.getOwnPropertyDescriptor(AuthController.prototype, name)?.value)
    .filter((handler): handler is (...args: unknown[]) => unknown => typeof handler === "function")
    .map((handler) => Reflect.getMetadata(PATH_METADATA, handler))
    .filter((path): path is string => typeof path === "string");
}

describe("AuthController routes", () => {
  it("只暴露 Web 统一认证路由，不再暴露微信身份登录", () => {
    const paths = authRoutePaths();

    expect(paths).toEqual(
      expect.arrayContaining(["login", "refresh", "logout", "change-password", "profile"])
    );
    expect(paths).not.toContain("wx-login");
  });
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run:

```bash
pnpm --filter @jiangkong/api test -- auth/auth.controller.spec.ts --runInBand
```

Expected: FAIL，`paths` 仍包含 `wx-login`。

- [ ] **Step 3：删除控制器和服务中的微信登录实现**

在 `auth.controller.ts` 中删除 `WxLoginDto` import 和整个 `@Post("wx-login")` 方法。

在 `auth.service.ts` 中删除：

- `Logger` import。
- `WxLoginDto` import。
- `private readonly logger` 字段。
- `wxLogin` 方法。
- `fetchWxSession` 方法。

保留 `login`、`refresh`、`logout`、`changePassword`、`updateMyProfile`、`issueTokens` 和岗位范围解析逻辑。

- [ ] **Step 4：删除已取消能力的 DTO 和旧测试**

删除 `services/api/src/auth/dto/wx-login.dto.ts`。

在 `auth.service.spec.ts` 中删除：

- `Logger` import。
- `WxLoginDto` import。
- 合法 DTO 参数表中的 `WxLoginDto` 项。
- 空字段参数表中的 `WxLoginDto` 项。
- “returns deduped role keys and trusted global role keys for wx login”测试。
- “微信会话失败时不回显供应商 errmsg”测试。

不得改写现有手机号登录、刷新令牌、改密和个人资料测试。

- [ ] **Step 5：运行 API 定向测试并确认 GREEN**

Run:

```bash
pnpm --filter @jiangkong/api test -- auth/auth.controller.spec.ts auth/auth.service.spec.ts --runInBand
```

Expected: 2 个测试文件全部 PASS，不再加载 `WxLoginDto`。

- [ ] **Step 6：扫描运行代码残留**

Run:

```bash
if rg -n 'WxLoginDto|wxLogin|fetchWxSession|auth\.wx_login|wx-login|WX_APP_ID|WX_APP_SECRET|WECHAT_APP_ID|WECHAT_APP_SECRET' \
  services/api/src --glob '!**/*.spec.ts'; then
  echo '微信认证运行代码仍有残留' >&2
  exit 1
fi
```

Expected: 退出码 0，扫描无命中。

- [ ] **Step 7：提交 API 清理**

```bash
git add services/api/src/auth
git commit -m "refactor: 移除微信身份登录入口"
```

### Task 2：删除小程序客户端

**Files:**

- Delete: `apps/miniprogram/**`

- [ ] **Step 1：确认删除范围严格为 19 个小程序文件**

Run:

```bash
find apps/miniprogram -type f -print | sort
```

Expected: 输出与本计划“第一阶段：运行面退出”的 19 个文件完全一致。

- [ ] **Step 2：删除整个小程序目录**

使用文件编辑工具删除 `apps/miniprogram` 下列出的全部受控文件，并让空目录自然消失。不得删除 `apps/web-admin`、`services/api/src/me` 或共享业务 API。

- [ ] **Step 3：验证客户端已删除而共享能力仍存在**

Run:

```bash
test ! -d apps/miniprogram
test -f services/api/src/me/me.service.ts
test -f apps/web-admin/src/api/core-flow-read.api.ts
rg -n 'getWorkItems|fetchWorkItems|/me/work-items' services/api/src/me apps/web-admin/src
```

Expected: `apps/miniprogram` 不存在；共享待办实现仍在 API、Web 首页和审批中心中有命中。

- [ ] **Step 4：提交客户端删除**

```bash
git add -A apps/miniprogram
git commit -m "refactor: 删除微信小程序客户端"
```

### Task 3：修正生产“系统配置”的登录说明

**Files:**

- Modify: `apps/web-admin/src/pages/settings/system-governance-readonly.config.test.ts`
- Modify: `apps/web-admin/src/pages/settings/system-governance-readonly.config.ts`

- [ ] **Step 1：先增加会失败的配置测试**

在 `system-governance-readonly.config.test.ts` 的登录配置测试中加入：

```ts
const loginItems = configGroupById("login")?.items ?? [];

expect(loginItems.map((item) => item.name)).toContain("手机网页登录");
expect(loginItems.map((item) => item.name)).not.toContain("小程序登录");
expect(loginItems.find((item) => item.name === "手机网页登录")).toMatchObject({
  value: "手机号 + 当前密码"
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/settings/system-governance-readonly.config.test.ts
```

Expected: FAIL，当前配置仍名为“小程序登录”。

- [ ] **Step 3：替换登录配置项**

把 `system-governance-readonly.config.ts` 中“小程序登录”项替换为：

```ts
{
  name: "手机网页登录",
  value: "手机号 + 当前密码",
  description: "手机端与电脑端使用同一 Web 和权限模型，微信仅用于扫码打开 HTTPS 页面。"
}
```

- [ ] **Step 4：运行测试并确认 GREEN**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/settings/system-governance-readonly.config.test.ts
```

Expected: PASS。

- [ ] **Step 5：提交 Web 配置修正**

```bash
git add apps/web-admin/src/pages/settings/system-governance-readonly.config.ts \
  apps/web-admin/src/pages/settings/system-governance-readonly.config.test.ts
git commit -m "fix: 更新手机网页登录配置说明"
```

### Task 4：统一当前有效架构文档

**Files:**

- Modify: 本计划“当前有效文档更新”列出的 13 个文件
- Create: `docs/superpowers/runbooks/2026-07-14-wechat-platform-retirement-checklist.md`

- [ ] **Step 1：统一写入当前移动端决策**

所有当前有效文档必须表达同一事实：

```markdown
移动端决策更新（2026-07-14）：微信小程序路线已永久取消。桌面与手机统一使用同一套 Web 系统；手机继续使用手机号和密码登录，微信仅用于扫码打开普通 HTTPS 网页，不作为身份凭证。共享待办、审批和业务接口继续保留。
```

具体修改：

- `AGENTS.md`：把“小程序是移动工作客户端”和“Web 与小程序共同调用后端”改为“Web 是唯一客户端体系，桌面与手机共同调用后端”；把小程序从后置范围改为永久取消范围；保留“不得复活旧 6 流程小程序假设”。
- `docs/design/建工智管_认证授权设计.md`：删除微信一键登录和绑定流程作为当前能力的描述；认证入口只保留手机号登录、刷新、登出、改密和个人资料维护；链接到已确认退出设计。
- `docs/design/web-admin-v2-enterprise-ui.md`：将移动端边界改为响应式 Web，不再宣称手机页面由小程序承担。
- `obsidian-current` 的 10 个当前主题文件：删除小程序技术栈、里程碑、页面和真机验收作为未来路线的表述，改为手机 Web 唯一移动入口。

日期化的 `建工智管_项目状态报告_YYYYMMDD.md` 保持历史原文，不批量改写。

- [ ] **Step 2：创建外部微信平台人工清单**

`docs/superpowers/runbooks/2026-07-14-wechat-platform-retirement-checklist.md` 必须包含：

```markdown
# 微信平台人工退出清单

本清单只供应用所有者在微信公众平台人工执行，不授权 Codex 登录或修改外部平台。

- 确认是否存在建工智管小程序 AppID，只记录“存在/不存在”，不记录完整 AppID。
- 如果存在已发布版本，先确认没有真实用户仍依赖，再停止服务或下架。
- 作废不再使用的 AppSecret，不把旧值写入文档、终端输出或 Git。
- 删除服务器中已停用的微信密钥配置前先备份配置文件权限与路径，不备份密钥到仓库。
- 验证微信扫码仍能打开 `https://jgzg.site` 普通网页。
- 在 `PROGRESS.md` 只记录完成状态、执行人和时间，不记录密钥或 OpenID。
```

- [ ] **Step 3：复核当前文档和历史边界**

Run:

```bash
rg -n '小程序|wx-login|wxOpenid|微信一键登录' AGENTS.md docs/design obsidian-current \
  --glob '!建工智管_项目状态报告_*.md'
```

Expected: 每个命中都属于“永久取消”“历史说明”或指向本次退出设计；不得再有当前功能、未来里程碑或移动工作端承诺。

- [ ] **Step 4：提交文档治理**

```bash
git add AGENTS.md docs/design obsidian-current \
  docs/superpowers/runbooks/2026-07-14-wechat-platform-retirement-checklist.md
git commit -m "docs: 统一微信小程序退出后的架构说明"
```

### Task 5：完成第一阶段本地全量门禁

**Files:**

- Modify: `PROGRESS.md`

- [ ] **Step 1：运行共享待办与认证回归**

```bash
pnpm --filter @jiangkong/api test -- \
  auth/auth.controller.spec.ts \
  auth/auth.service.spec.ts \
  me/me.controller.spec.ts \
  me/me.service.spec.ts \
  --runInBand
```

Expected: 全部 PASS，手机号认证与 `/me/work-items` 共享能力不回退。

- [ ] **Step 2：运行 Web 定向回归**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/pages/settings/system-governance-readonly.config.test.ts \
  src/pages/home/home.config.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 3：运行 API、Web 和 Prisma 门禁**

```bash
pnpm --filter @jiangkong/api exec prisma format
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

Expected: 所有命令退出 0。第一阶段 Prisma schema 仍保留 `wxOpenid`，不得生成迁移。

- [ ] **Step 4：执行第一阶段残留分类扫描**

```bash
test ! -d apps/miniprogram
if rg -n 'WxLoginDto|wxLogin|fetchWxSession|auth\.wx_login|wx-login|WX_APP_ID|WX_APP_SECRET|WECHAT_APP_ID|WECHAT_APP_SECRET' \
  services/api/src apps/web-admin/src --glob '!**/*.spec.ts' --glob '!**/*.test.ts'; then
  echo '运行面仍有微信身份登录残留' >&2
  exit 1
fi
rg -n 'wxOpenid' services/api/prisma/schema.prisma services/api/prisma/migrations
```

Expected: 运行面扫描无命中；`wxOpenid` 只在当前 Prisma schema 和初始历史迁移中存在。

- [ ] **Step 5：更新 `PROGRESS.md` 并提交第一阶段候选记录**

记录：

- 删除范围和保留的共享能力。
- API/Web/Prisma 验证命令与实际通过数量。
- 第一阶段无迁移、未连接生产、未推送或部署。
- 代码候选提交 SHA。
- 下一闸门是用户授权推送、快进 `main`、生产部署和微信密钥配置处理。

```bash
git add PROGRESS.md
git commit -m "docs: 记录微信小程序运行面清理候选"
git status --short
```

Expected: 工作树干净。

## 3. 第一阶段生产发布

### Task 6：获得明确授权后发布运行面清理

**Gate:** 在执行本 Task 前，向用户列出目标 SHA、无数据库迁移、验证结果和生产动作，并获得以下明确授权：

1. 推送候选分支并严格快进 `main`。
2. 触发生产部署。
3. 只读检查生产微信环境变量键名和历史访问计数，不输出值。
4. 如果存在微信密钥键，允许备份 `/etc/jiangkong/api.env` 后仅删除 4 个微信键并重启 API。

没有完整授权时停止。

- [ ] **Step 1：推送候选并严格快进 `main`**

```bash
TARGET_SHA="$(git rev-parse HEAD)"
ROOT=/Users/leoyang/Projects/建工智管
git status --short
test -z "$(git status --porcelain=v1)"
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git push -u origin codex/retire-wechat-miniprogram
git -C "$ROOT" status --short
test -z "$(git -C "$ROOT" status --porcelain=v1)"
git -C "$ROOT" fetch origin main
git -C "$ROOT" merge-base --is-ancestor origin/main "$TARGET_SHA"
git -C "$ROOT" merge --ff-only "$TARGET_SHA"
git -C "$ROOT" push origin main
```

Expected: 工作树干净，`main` 只做快进，远端接受目标 SHA。

- [ ] **Step 2：锁定并监控对应 GitHub Actions**

```bash
RUN_ID="$(gh run list --workflow deploy-production.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
test "$(gh run view "$RUN_ID" --json headSha --jq '.headSha')" = "$TARGET_SHA"
gh run watch "$RUN_ID" --exit-status
```

Expected: Verify build 和 Deploy to server 均成功，`headSha` 精确等于 `TARGET_SHA`。

- [ ] **Step 3：复核生产代码和服务健康**

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 \
  "test \"\$(git -C /opt/jiangkong rev-parse HEAD)\" = '$TARGET_SHA' && \
   test -z \"\$(git -C /opt/jiangkong status --porcelain=v1 --untracked-files=no)\" && \
   systemctl is-active jiangkong-api && \
   systemctl is-active nginx && \
   curl -fsS http://127.0.0.1:3000/health >/dev/null"
curl -fsS https://jgzg.site/api/health >/dev/null
```

Expected: 生产 HEAD 精确命中，tracked 工作树干净，API/Nginx active，内外健康检查通过。

- [ ] **Step 4：先只输出微信配置键状态和既有请求计数**

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 <<'REMOTE'
set -euo pipefail
awk -F= '/^(WX_APP_ID|WX_APP_SECRET|WECHAT_APP_ID|WECHAT_APP_SECRET)=/{print $1 "=configured"}' \
  /etc/jiangkong/api.env
sudo zgrep -h '"POST /api/auth/wx-login' /var/log/nginx/access.log* 2>/dev/null | wc -l
REMOTE
```

Expected: 只输出键名和整数计数，不输出密钥、请求体、OpenID 或用户信息。历史请求计数大于 0 时，记录并阻断第二阶段，先调查是否有真实用户依赖。

- [ ] **Step 5：验证微信登录路由已消失**

历史计数完成后再发送专用探针，避免把本次 404 验证误计为既有真实调用：

```bash
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST https://jgzg.site/api/auth/wx-login \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: jiangkong-retirement-probe/1.0' \
  --data '{"code":"retirement-probe"}')"
test "$STATUS" = "404"
```

Expected: HTTP 404，不调用微信供应商接口。

- [ ] **Step 6：按授权删除已停用密钥键**

只有 Step 5 输出配置键时执行：

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 <<'REMOTE'
set -euo pipefail
stamp="$(date +%Y%m%d-%H%M%S)"
backup="/etc/jiangkong/api.env.before-wechat-retirement-$stamp"
sudo install -m 600 /etc/jiangkong/api.env "$backup"
sudo sed -i -E '/^(WX_APP_ID|WX_APP_SECRET|WECHAT_APP_ID|WECHAT_APP_SECRET)=/d' \
  /etc/jiangkong/api.env
if sudo grep -Eq '^(WX_APP_ID|WX_APP_SECRET|WECHAT_APP_ID|WECHAT_APP_SECRET)=' \
  /etc/jiangkong/api.env; then
  echo '微信密钥键删除失败' >&2
  exit 1
fi
if ! sudo systemctl restart jiangkong-api || \
   ! curl -fsS http://127.0.0.1:3000/health >/dev/null; then
  sudo install -m 600 "$backup" /etc/jiangkong/api.env
  sudo systemctl restart jiangkong-api
  echo '删除微信密钥后健康检查失败，已恢复原配置' >&2
  exit 1
fi
sudo rm -f "$backup"
REMOTE
```

Expected: 只删除 4 个微信键；API 恢复健康后删除含旧密钥的临时备份。失败时恢复原配置并保持 API 可用。不得显示配置文件内容。

- [ ] **Step 7：完成用户可见冒烟**

由用户使用真实账号确认：

- 手机号密码登录正常。
- 首页待办和审批中心正常。
- 手机浏览器可打开台账和审批。
- 微信扫一扫可以打开 `https://jgzg.site` 普通网页。
- 手写签名二维码入口不受影响。
- 系统配置显示“手机网页登录”，不再显示“小程序登录”。

任一失败都停止第二阶段并回滚第一阶段代码或修复后重新验收。

## 4. 第二阶段：生产只读核验和数据库迁移候选

### Task 7：只读核验生产 `wxOpenid`

**Gate:** 第一阶段生产冒烟全部通过后执行。此 Task 只读，不创建备份或临时库。

- [ ] **Step 1：统计非空值，不输出具体标识**

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 <<'REMOTE'
set -euo pipefail
set -a
. /etc/jiangkong/api.env
set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --tuples-only --no-align \
  --command 'SELECT COUNT(*) FROM "User" WHERE "wxOpenid" IS NOT NULL;'
REMOTE
```

Expected: 只输出一个非负整数。

- [ ] **Step 2：执行硬闸门**

- 结果大于 0：停止整个第二阶段；只向用户报告账号数量，不输出 OpenID，另行设计会话撤销、审计和历史映射处置。
- 结果等于 0：记录只读证据，允许进入 Task 8。

### Task 8：用 schema 测试驱动字段删除迁移

**Files:**

- Create: `services/api/src/database/user-wx-openid-retirement-schema.spec.ts`
- Create: `services/api/prisma/migrations/20260714120000_wechat_identity_retirement/migration.sql`
- Modify: `services/api/prisma/schema.prisma`

- [ ] **Step 1：先新增会失败的迁移结构测试**

创建 `user-wx-openid-retirement-schema.spec.ts`：

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("wechat identity retirement schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260714120000_wechat_identity_retirement/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("removes wxOpenid from the current Prisma user model", () => {
    const userModel = schema.match(/model User \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(userModel).not.toContain("wxOpenid");
  });

  it("fails closed before dropping the exact legacy field", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain('LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE');
    expect(migration).toContain('FROM "User"');
    expect(migration).toContain('WHERE "wxOpenid" IS NOT NULL');
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toContain('DROP INDEX "User_wxOpenid_key"');
    expect(migration).toContain('ALTER TABLE "User" DROP COLUMN "wxOpenid"');
    expect(migration).toContain("COMMIT;");
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/iu);
  });
});
```

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  database/user-wx-openid-retirement-schema.spec.ts --runInBand
```

Expected: FAIL，当前 schema 仍有 `wxOpenid` 且迁移文件不存在。

- [ ] **Step 3：删除 Prisma 字段并创建原子迁移**

从 `User` model 删除：

```prisma
wxOpenid String? @unique
```

创建 `migration.sql`：

```sql
BEGIN;

LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "wxOpenid" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'non-null User.wxOpenid rows block wechat identity retirement';
  END IF;
END $$;

DROP INDEX "User_wxOpenid_key";
ALTER TABLE "User" DROP COLUMN "wxOpenid";

COMMIT;
```

迁移不得包含数据清空、回填或其他表结构变更。

- [ ] **Step 4：运行迁移结构测试并确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  database/user-wx-openid-retirement-schema.spec.ts --runInBand
```

Expected: PASS。

- [ ] **Step 5：运行第二阶段本地门禁**

```bash
pnpm --filter @jiangkong/api exec prisma format
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api test -- \
  database/user-wx-openid-retirement-schema.spec.ts \
  auth/auth.controller.spec.ts \
  auth/auth.service.spec.ts \
  me/me.service.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api build
git diff --check
```

Expected: 全部退出 0。

- [ ] **Step 6：确认仅初始历史迁移保留旧字段事实**

```bash
rg -n 'wxOpenid|User_wxOpenid_key' services/api \
  --glob '!prisma/migrations/20260620094800_init/migration.sql' \
  --glob '!prisma/migrations/20260714120000_wechat_identity_retirement/migration.sql' \
  --glob '!src/database/user-wx-openid-retirement-schema.spec.ts'
```

Expected: 无命中。

- [ ] **Step 7：提交数据库候选**

```bash
git add services/api/prisma/schema.prisma \
  services/api/prisma/migrations/20260714120000_wechat_identity_retirement/migration.sql \
  services/api/src/database/user-wx-openid-retirement-schema.spec.ts
git commit \
  -m "refactor!: 删除微信身份字段" \
  -m "迁移在事务内阻断任何非空 wxOpenid，且不改写其他用户或业务事实。" \
  -m "BREAKING CHANGE: User.wxOpenid 与 User_wxOpenid_key 永久删除；系统仅保留手机号密码认证。"
```

## 5. 第二阶段备份与临时恢复库演练

### Task 9：获得授权后推送候选、备份并演练迁移

**Gate:** 向用户报告第二阶段候选 SHA、生产非空计数为 0、本地验证结果和完整命令边界，并获得以下授权：

1. 只推送候选分支，不快进 `main`，不触发生产部署。
2. 创建最新生产数据库备份。
3. 创建一个临时恢复库并执行候选迁移演练。
4. 演练后删除临时库和服务器临时 worktree，保留 600 权限的生产备份。

- [ ] **Step 1：推送第二阶段候选分支**

```bash
CANDIDATE_BRANCH="codex/retire-wechat-miniprogram"
DRILL_SHA="$(git rev-parse HEAD)"
git status --short
test -z "$(git status --porcelain=v1)"
git push -u origin "$CANDIDATE_BRANCH"
```

Expected: 工作树干净；只更新候选分支，`origin/main` 未变化。

- [ ] **Step 2：在生产服务器创建备份并完成临时库演练**

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 \
  "env DRILL_SHA='$DRILL_SHA' bash -s" <<'REMOTE'
set -euo pipefail

REPO=/opt/jiangkong
RESTORE_DB="jiangkong_wx_retirement_drill_$(date +%Y%m%d%H%M%S)"
DRILL_TREE="/tmp/jiangkong-wx-retirement-$DRILL_SHA"
BACKUP_FILE=""

cleanup() {
  sudo -u postgres dropdb --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  git -C "$REPO" worktree remove --force "$DRILL_TREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

set -a
. /etc/jiangkong/api.env
set +a

NON_NULL_COUNT="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --tuples-only --no-align \
  --command 'SELECT COUNT(*) FROM "User" WHERE "wxOpenid" IS NOT NULL;')"
test "$NON_NULL_COUNT" = "0"

BACKUP_FILE="$(BACKUP_DIR=/srv/jiangkong-backups/db "$REPO/scripts/ops/db-backup.sh")"
pg_restore --list "$BACKUP_FILE" >/dev/null
test "$(stat -c '%a' "$BACKUP_FILE")" = "600"
sha256sum "$BACKUP_FILE"
stat -c 'backup=%n bytes=%s mode=%a owner=%U:%G' "$BACKUP_FILE"

git -C "$REPO" fetch origin codex/retire-wechat-miniprogram
git -C "$REPO" cat-file -e "$DRILL_SHA^{commit}"
git -C "$REPO" worktree add --detach "$DRILL_TREE" "$DRILL_SHA"

export DATABASE_URL RESTORE_DB
DB_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).username))')"
RESTORE_DATABASE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname=`/${process.env.RESTORE_DB}`;process.stdout.write(u.toString())')"
export RESTORE_DATABASE_URL

sudo -u postgres createdb --owner="$DB_USER" "$RESTORE_DB"
BACKUP_FILE="$BACKUP_FILE" RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
  "$REPO/scripts/ops/db-restore-drill.sh"

USER_COUNT_BEFORE="$(psql "$RESTORE_DATABASE_URL" -X -Atc 'SELECT COUNT(*) FROM "User";')"

(
  cd "$DRILL_TREE/services/api"
  DATABASE_URL="$RESTORE_DATABASE_URL" \
    "$REPO/services/api/node_modules/.bin/prisma" migrate deploy --schema prisma/schema.prisma
  DATABASE_URL="$RESTORE_DATABASE_URL" \
    "$REPO/services/api/node_modules/.bin/prisma" migrate status --schema prisma/schema.prisma
)

USER_COUNT_AFTER="$(psql "$RESTORE_DATABASE_URL" -X -Atc 'SELECT COUNT(*) FROM "User";')"
test "$USER_COUNT_AFTER" = "$USER_COUNT_BEFORE"
test "$(psql "$RESTORE_DATABASE_URL" -X -Atc \
  \"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='wxOpenid';\")" = "0"

echo "drill_sha=$DRILL_SHA"
echo "non_null_wx_openid=0"
echo "user_count_before=$USER_COUNT_BEFORE"
echo "user_count_after=$USER_COUNT_AFTER"
echo "temporary_column_count=0"
REMOTE
```

Expected:

- 最新备份为 PostgreSQL custom format，`pg_restore --list` 通过，权限 600。
- 临时库迁移成功，`prisma migrate status` 最新。
- 用户行数迁移前后相同。
- 临时库 `wxOpenid` 字段计数为 0。
- trap 删除临时库和 worktree，正式库未执行迁移。

- [ ] **Step 3：记录演练证据但不预写正式结果**

在 `PROGRESS.md` 记录备份路径、大小、权限、SHA-256、候选 SHA、临时库迁移状态和正式库仍未迁移。不得写入 `DATABASE_URL`、OpenID 或密钥。

```bash
git add PROGRESS.md
git commit -m "docs: 记录微信身份字段迁移演练"
git push origin codex/retire-wechat-miniprogram
```

Expected: 只更新候选分支，不触发正式部署。

## 6. 第二阶段正式迁移与最终收口

### Task 10：获得正式迁移授权后快进 `main`

**Gate:** 向用户提供最新候选 SHA、演练备份证据、临时库演练结果、迁移 SQL、失败恢复命令，并获得明确授权：创建正式迁移前的最新生产备份、严格快进 `main`、触发生产部署、执行正式库 1 个迁移、完成生产只读复验和后续进度文档同步。

- [ ] **Step 1：发布前再次确认生产非空计数为 0**

重复 Task 7 的只读 SQL。Expected: `0`。若不是 `0`，停止，不创建正式迁移备份、不推送 `main`。

- [ ] **Step 2：创建正式迁移前的最新生产备份**

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 <<'REMOTE'
set -euo pipefail
set -a
. /etc/jiangkong/api.env
set +a

test "$(psql "$DATABASE_URL" -X -Atc 'SELECT COUNT(*) FROM "User" WHERE "wxOpenid" IS NOT NULL;')" = "0"
BACKUP_FILE="$(BACKUP_DIR=/srv/jiangkong-backups/db /opt/jiangkong/scripts/ops/db-backup.sh)"
pg_restore --list "$BACKUP_FILE" >/dev/null
test "$(stat -c '%a' "$BACKUP_FILE")" = "600"
sha256sum "$BACKUP_FILE"
stat -c 'backup=%n bytes=%s mode=%a owner=%U:%G' "$BACKUP_FILE"
REMOTE
```

Expected: 正式迁移前生成一份新的 custom-format 备份，清单可读、权限 600，并记录路径、大小和 SHA-256。

- [ ] **Step 3：严格快进并推送 `main`**

```bash
ROOT=/Users/leoyang/Projects/建工智管
git fetch origin main codex/retire-wechat-miniprogram
TARGET_SHA="$(git rev-parse origin/codex/retire-wechat-miniprogram)"
git -C "$ROOT" status --short
test -z "$(git -C "$ROOT" status --porcelain=v1)"
git -C "$ROOT" fetch origin main codex/retire-wechat-miniprogram
git -C "$ROOT" merge-base --is-ancestor origin/main "$TARGET_SHA"
git -C "$ROOT" merge --ff-only "$TARGET_SHA"
git -C "$ROOT" push origin main
```

Expected: `main` 严格快进到候选 SHA；推送触发标准生产工作流。

- [ ] **Step 4：监控目标工作流并处理迁移失败**

```bash
RUN_ID="$(gh run list --workflow deploy-production.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
test "$(gh run view "$RUN_ID" --json headSha --jq '.headSha')" = "$TARGET_SHA"
gh run watch "$RUN_ID" --exit-status
```

Expected: Verify build 和 Deploy to server 均成功。

如果部署失败，立即查看日志。若失败发生在 `prisma migrate deploy` 且 API 被停止，执行：

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 \
  'sudo systemctl restart jiangkong-api && curl -fsS http://127.0.0.1:3000/health >/dev/null'
```

事务迁移在异常时整体回滚；第一阶段 API 不读取 `wxOpenid`，可安全恢复运行。不得跳过失败迁移或手工标记为已应用。

- [ ] **Step 5：复核正式库、代码和服务**

```bash
ssh -i ~/.ssh/jgzg_prod -o IdentitiesOnly=yes ubuntu@162.14.116.192 \
  "env TARGET_SHA='$TARGET_SHA' bash -s" <<'REMOTE'
set -euo pipefail
test "$(git -C /opt/jiangkong rev-parse HEAD)" = "$TARGET_SHA"
test -z "$(git -C /opt/jiangkong status --porcelain=v1 --untracked-files=no)"
systemctl is-active jiangkong-api
systemctl is-active nginx
curl -fsS http://127.0.0.1:3000/health >/dev/null

set -a
. /etc/jiangkong/api.env
set +a

test "$(psql "$DATABASE_URL" -X -Atc \
  \"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='wxOpenid';\")" = "0"

cd /opt/jiangkong/services/api
pnpm exec prisma migrate status
REMOTE

curl -fsS https://jgzg.site/api/health >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST https://jgzg.site/api/auth/wx-login \
  -H 'Content-Type: application/json' \
  --data '{"code":"retirement-probe"}')" = "404"
```

Expected: 生产 HEAD 精确命中，正式库字段不存在，迁移最新，API/Nginx/HTTPS 健康，旧路由 404。

- [ ] **Step 6：执行最终业务冒烟**

使用真实账号确认：

- 桌面和手机均可手机号登录。
- 首次改密与个人设置正常。
- 首页待办和审批中心正常。
- 合同、结算、付款台账可读。
- 微信扫码打开普通网页正常。
- 手写签名二维码流程不受影响。

- [ ] **Step 7：写入最终生产记录**

从本步骤开始切换到主工作树：

```bash
cd /Users/leoyang/Projects/建工智管
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain=v1)"
```

创建 `docs/progress/2026-07-14-wechat-miniprogram-retirement-release.md`，记录：

- 两个生产单元各自的目标 SHA 和 GitHub Actions run ID。
- 第一阶段路由 404、手机号登录、手机 Web 和共享待办验收。
- 微信配置键处理结果，只写键名和状态。
- 正式迁移前非空计数 0。
- 备份路径、权限、大小和 SHA-256。
- 临时恢复库演练、清理结果和用户行数不变证据。
- 正式迁移名称、字段不存在和 `prisma migrate status` 结果。
- API、Nginx、HTTPS 与业务冒烟结果。
- 外部微信平台仍需用户人工执行或已完成的状态。

更新 `PROGRESS.md`：把永久退出状态从 `[~]` 改为 `[x]`，只有全部完成定义满足时才能勾选。

- [ ] **Step 8：提交并按授权同步最终文档**

```bash
git add PROGRESS.md docs/progress/2026-07-14-wechat-miniprogram-retirement-release.md
git commit -m "docs: 记录微信小程序永久退出结果"
git push origin main
```

Expected: 文档提交成功；若推送触发无迁移文档部署，继续监控对应 Actions 并复核生产 HEAD 和健康检查。

## 7. 最终完成门槛

执行者必须逐项确认：

- [ ] `apps/miniprogram` 不存在。
- [ ] `/api/auth/wx-login` 返回 404。
- [ ] 运行代码不再读取微信 AppID、AppSecret 或 OpenID。
- [ ] 系统配置只显示“手机网页登录”。
- [ ] 手机 Web、手机号登录、待办、审批和共享业务接口通过回归。
- [ ] 生产非空 `wxOpenid` 统计为 0。
- [ ] 生产备份、SHA-256 和临时恢复库迁移演练证据完整。
- [ ] 正式库不存在 `wxOpenid` 字段和 `User_wxOpenid_key`。
- [ ] 当前有效文档统一为 Web 唯一客户端体系。
- [ ] 历史迁移、历史 Git 和日期化历史状态报告保留。
- [ ] `PROGRESS.md` 与生产事实一致。
- [ ] `origin/main`、本地主分支和生产 `/opt/jiangkong` 命中已记录 SHA。

任何一项未满足，方案 C 仍为“部分完成”，不得宣布永久退出已经完成。
