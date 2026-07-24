# 顶部最近打开移除与路由滚动治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Web Admin 完整移除“最近打开”展示和记录，并让新导航回顶、历史导航恢复滚动、锚点定位与主内容无障碍聚焦各司其职。

**Architecture:** `AdminLayout` 不再监听业务详情路由，只在首次挂载时清理旧本地存储键。Vue Router 的 `scrollBehavior` 成为唯一滚动决策点，按 saved position、hash、top 的顺序返回；route afterEach 仍聚焦主内容，但使用 `preventScroll`，避免焦点产生第二次隐式滚动。

**Tech Stack:** Vue 3、Vue Router 4、TypeScript、TDesign Vue Next、Vitest、Playwright Chromium/WebKit、浏览器 History/Storage API

---

## 实施边界与文件职责

本计划不把顶部改成 sticky，不新增页签缓存，不修改业务路由权限，也不清理任何服务端业务数据。旧本地存储清理只匹配 `jiangkong:recent-business-routes` 及其账号后缀，不能使用 `localStorage.clear()`。

### 新建文件

- `apps/web-admin/src/app/legacy-layout-storage.ts`：精确识别并删除旧“最近打开”存储键。
- `apps/web-admin/src/app/legacy-layout-storage.test.ts`：键匹配、账号后缀和其他数据保护测试。
- `apps/web-admin/e2e/admin-navigation-scroll.e2e.ts`：新导航、后退/前进、hash、focus 和存储清理双浏览器验收。
- `apps/web-admin/playwright.admin-navigation-scroll.config.ts`：独立 Chromium/WebKit 配置。

### 修改文件

- `apps/web-admin/src/app/AdminLayout.vue`：移除条带、路由 watcher、读写函数和样式；挂载时安全清理旧键。
- `apps/web-admin/src/routes/index.ts`：增加可单测的滚动决策和 `preventScroll` 聚焦。
- `apps/web-admin/src/routes/index.test.ts`：saved position、hash、top 和 focus 参数测试。
- `apps/web-admin/e2e/detail-route-switch-regression.e2e.ts`：去除对最近打开条带的测试依赖，继续验证同文档详情切换的陈旧响应隔离。
- `PROGRESS.md`：登记移除范围和浏览器证据。

### 删除文件

- `apps/web-admin/src/app/recent-business-routes.ts`
- `apps/web-admin/src/app/recent-business-routes.test.ts`

## Task 1: 精确清理旧本地存储而不伤其他偏好

**Files:**
- Create: `apps/web-admin/src/app/legacy-layout-storage.ts`
- Create: `apps/web-admin/src/app/legacy-layout-storage.test.ts`

- [ ] **Step 1: 写失败测试**

测试文件先定义最小 Storage：

```ts
function createMemoryStorage(seed: Record<string, string>): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}
```

```ts
it("removes only legacy recent-business route keys", () => {
  const storage = createMemoryStorage({
    "jiangkong:recent-business-routes": "[]",
    "jiangkong:recent-business-routes:user-1": "[]",
    "jiangkong:recent-business-routes:user-2": "[]",
    "jiangkong:column-settings:user-1": "{\"contracts\":[]}",
    "other-app:recent-business-routes": "keep"
  });

  expect(clearLegacyRecentBusinessRoutes(storage)).toBe(3);
  expect(storage.getItem("jiangkong:recent-business-routes")).toBeNull();
  expect(storage.getItem("jiangkong:column-settings:user-1")).not.toBeNull();
  expect(storage.getItem("other-app:recent-business-routes")).toBe("keep");
});
```

另测 storage 为空、`storage.key(index)` 返回 null 和 removeItem 抛出时调用方可安全捕获。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/app/legacy-layout-storage.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现精确键清理**

```ts
export const LEGACY_RECENT_BUSINESS_STORAGE_PREFIX =
  "jiangkong:recent-business-routes";

export function clearLegacyRecentBusinessRoutes(storage: Storage): number {
  const keys = Array.from(
    { length: storage.length },
    (_, index) => storage.key(index)
  ).filter((key): key is string =>
    typeof key === "string" &&
    (key === LEGACY_RECENT_BUSINESS_STORAGE_PREFIX ||
      key.startsWith(`${LEGACY_RECENT_BUSINESS_STORAGE_PREFIX}:`))
  );

  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}
```

函数不捕获错误；布局调用方负责将不可用 storage 降级为无动作，测试可直接验证纯行为。

- [ ] **Step 4: 运行测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/app/legacy-layout-storage.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交兼容清理**

```bash
git add apps/web-admin/src/app/legacy-layout-storage.ts apps/web-admin/src/app/legacy-layout-storage.test.ts
git commit -m "fix: clean legacy recent route storage"
```

## Task 2: 从布局完整移除“最近打开”

**Files:**
- Modify: `apps/web-admin/src/app/AdminLayout.vue`
- Delete: `apps/web-admin/src/app/recent-business-routes.ts`
- Delete: `apps/web-admin/src/app/recent-business-routes.test.ts`
- Modify: `apps/web-admin/src/app/legacy-layout-storage.test.ts`

- [ ] **Step 1: 写布局静态契约失败断言**

在 storage 测试旁新增 source-contract 测试，读取 `AdminLayout.vue` 后断言：

```ts
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./AdminLayout.vue", import.meta.url),
  "utf8"
);
expect(source).not.toContain("recent-strip");
expect(source).not.toContain("recentBusinessRoutes");
expect(source).not.toContain("upsertRecentBusinessRoute");
expect(source).toContain("clearLegacyRecentBusinessRoutes");
```

项目已有 UI source-contract helper 时复用；否则使用 Vitest 的 `readFileSync(new URL("./AdminLayout.vue", import.meta.url), "utf8")`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/app/legacy-layout-storage.test.ts
```

Expected: FAIL，布局仍包含 recent strip。

- [ ] **Step 3: 删除模板、状态、watcher 和样式**

从 `AdminLayout.vue` 删除：

- `.recent-strip` 整段模板；
- `recent-business-routes` 的所有 import；
- recent routes ref 和 storage key；
- route watcher 中的 upsert/save；
- load/save localStorage 函数；
- `.recent-strip` 及移动 media query 样式。

保留布局其他 badge、菜单、账号和 route 响应逻辑。新增：

```ts
import { onMounted, ref, watch } from "vue";
import { clearLegacyRecentBusinessRoutes } from "./legacy-layout-storage";

onMounted(() => {
  try {
    clearLegacyRecentBusinessRoutes(window.localStorage);
  } catch {
    // 浏览器禁用本地存储时不影响主布局和业务导航。
  }
});
```

如果 `onMounted` 已导入则合并，不重复导入。

- [ ] **Step 4: 删除旧辅助模块和旧测试**

删除两个 `recent-business-routes` 文件。运行：

```bash
rg -n "recent-business-routes|recent-strip|最近打开|recentBusinessRoutes" apps/web-admin/src
```

Expected: 只允许在 `legacy-layout-storage.ts`、对应测试及解释旧键的注释中出现 `recent-business-routes`；页面不再出现“最近打开”。

- [ ] **Step 5: 运行布局相关测试和 UI 检查**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/app/legacy-layout-storage.test.ts
pnpm --filter @jiangkong/web-admin check:ui
```

Expected: PASS。

- [ ] **Step 6: 提交布局移除**

```bash
git add apps/web-admin/src/app/AdminLayout.vue apps/web-admin/src/app/legacy-layout-storage.test.ts apps/web-admin/src/app/recent-business-routes.ts apps/web-admin/src/app/recent-business-routes.test.ts
git commit -m "feat: remove recent business routes"
```

## Task 3: 让 Vue Router 成为唯一滚动决策点

**Files:**
- Modify: `apps/web-admin/src/routes/index.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`

- [ ] **Step 1: 写滚动优先级失败测试**

```ts
it("restores browser history position before considering hash", () => {
  expect(resolveRouteScrollPosition(
    { hash: "#files" },
    { left: 0, top: 640 }
  )).toEqual({ left: 0, top: 640 });
});

it("uses a hash anchor when no saved position exists", () => {
  expect(resolveRouteScrollPosition(
    { hash: "#files" },
    null
  )).toEqual({ el: "#files" });
});

it("returns to the top for a new route", () => {
  expect(resolveRouteScrollPosition(
    { hash: "" },
    null
  )).toEqual({ left: 0, top: 0 });
});
```

- [ ] **Step 2: 写 focus 不滚动失败测试**

把现有 main content focus 断言收紧为：

```ts
expect(main.focus).toHaveBeenCalledWith({ preventScroll: true });
```

再测元素不存在时不抛错。

- [ ] **Step 3: 运行路由测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/routes/index.test.ts
```

Expected: FAIL；当前没有 `scrollBehavior`，focus 也没有参数。

- [ ] **Step 4: 实现可单测的滚动决策**

在 router 创建前导出：

```ts
type SavedScrollPosition = { left: number; top: number } | null;

export function resolveRouteScrollPosition(
  to: { hash?: string },
  savedPosition: SavedScrollPosition
) {
  if (savedPosition) return savedPosition;
  if (to.hash) return { el: to.hash };
  return { left: 0, top: 0 };
}
```

Router 配置改为：

```ts
export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    return resolveRouteScrollPosition(to, savedPosition);
  }
});
```

不要增加 smooth behavior；历史位置和锚点定位需要确定性。

- [ ] **Step 5: 修复主内容聚焦**

```ts
export function focusMainContent() {
  const mainContent = document.querySelector<HTMLElement>("#main-content");
  mainContent?.focus({ preventScroll: true });
}
```

保留 afterEach 中的 next tick/微任务调度和 document title 逻辑，只替换 focus 参数。

- [ ] **Step 6: 运行路由测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/routes/index.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交路由治理**

```bash
git add apps/web-admin/src/routes/index.ts apps/web-admin/src/routes/index.test.ts
git commit -m "fix: govern admin route scrolling"
```

## Task 4: 移除 E2E 对“最近打开”的隐式依赖

**Files:**
- Modify: `apps/web-admin/e2e/detail-route-switch-regression.e2e.ts`

- [ ] **Step 1: 增加同文档 SPA 导航 helper**

```ts
async function navigateWithinApp(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: window.history.state
    }));
  }, path);
}
```

- [ ] **Step 2: 替换最近条带点击**

删除 `loginWithRecentRoute` 的 localStorage seed，改为普通 login。付款详情 A/B 和结算详情 A/B 的切换均调用：

```ts
await navigateWithinApp(page, "/payments/payment-b");
```

测试仍必须保持原来的延迟响应顺序和最终页面断言，证明 A 的晚到响应不会覆盖 B；不能改用 `page.goto`，因为那会失去同文档路由回归价值。

- [ ] **Step 3: 运行回归 E2E**

使用该文件当前既有 Playwright 配置和命令；先从文件或 package scripts 确认配置名，再运行单文件：

```bash
pnpm --filter @jiangkong/web-admin exec playwright test e2e/detail-route-switch-regression.e2e.ts
```

Expected: 付款和结算陈旧响应隔离场景全部 PASS。

- [ ] **Step 4: 提交回归测试调整**

```bash
git add apps/web-admin/e2e/detail-route-switch-regression.e2e.ts
git commit -m "test: decouple detail routing from recent strip"
```

## Task 5: 用双浏览器验收回顶、历史恢复、锚点和焦点

**Files:**
- Create: `apps/web-admin/e2e/admin-navigation-scroll.e2e.ts`
- Create: `apps/web-admin/playwright.admin-navigation-scroll.config.ts`

- [ ] **Step 1: 建立独立双浏览器配置**

```ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: "admin-navigation-scroll.e2e.ts",
  use: { baseURL: "http://127.0.0.1:4190", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: devices["Desktop Safari"] }
  ],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4190",
    port: 4190,
    reuseExistingServer: false
  }
});
```

- [ ] **Step 2: 写旧键清理和条带消失场景**

在 page load 前写入：

```ts
await page.addInitScript(() => {
  localStorage.setItem("jiangkong:recent-business-routes:user-1", "[]");
  localStorage.setItem("jiangkong:column-settings:user-1", "{\"contracts\":[]}");
});
```

登录进入布局后断言：

```ts
expect(await page.locator(".recent-strip").count()).toBe(0);
expect(await page.evaluate(() =>
  localStorage.getItem("jiangkong:recent-business-routes:user-1")
)).toBeNull();
expect(await page.evaluate(() =>
  localStorage.getItem("jiangkong:column-settings:user-1")
)).not.toBeNull();
```

- [ ] **Step 3: 写新导航回顶和顶部自然离开场景**

向 `#main-content` 注入稳定 spacer，滚动到 600px，点击真实菜单进入另一 route，断言新页：

```ts
await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
await expect(page.locator("#main-content")).toBeFocused();
```

再手动滚动，断言 header 的 bounding box 已离开视口；不要断言 header sticky。

- [ ] **Step 4: 写 back/forward 和 hash 场景**

页面 A 滚到 700px，导航 B 滚到 350px，然后：

```ts
await page.goBack();
await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)))
  .toBeGreaterThan(650);
await page.goForward();
await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)))
  .toBeGreaterThan(300);
```

访问带 `#target-anchor` 的 route，断言锚点进入视口且 `#main-content` 仍获得焦点。记录 focus 前后 scrollY，差值应小于 2px，证明 `preventScroll` 没覆盖 router 结果。

- [ ] **Step 5: 运行 Chromium 与 WebKit**

Run:

```bash
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.admin-navigation-scroll.config.ts
```

Expected: 两个浏览器全部 PASS。

- [ ] **Step 6: 提交浏览器证据**

```bash
git add apps/web-admin/e2e/admin-navigation-scroll.e2e.ts apps/web-admin/playwright.admin-navigation-scroll.config.ts
git commit -m "test: cover admin navigation scrolling"
```

## Task 6: 运行门禁、复核删除范围并更新进度

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: 运行定向测试**

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/app/legacy-layout-storage.test.ts apps/web-admin/src/routes/index.test.ts
pnpm --filter @jiangkong/web-admin exec playwright test e2e/detail-route-switch-regression.e2e.ts
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.admin-navigation-scroll.config.ts
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行 Web 门禁**

```bash
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 3: 做残留扫描**

```bash
rg -n "最近打开|recent-strip|upsertRecentBusinessRoute|readRecentBusinessRoutes|recentBusinessRoutes" apps/web-admin/src apps/web-admin/e2e
```

Expected: 零结果。再运行：

```bash
rg -n "jiangkong:recent-business-routes" apps/web-admin/src apps/web-admin/e2e
```

Expected: 只在 legacy storage 清理实现、测试和兼容 E2E seed 中出现。

- [ ] **Step 4: 更新 `PROGRESS.md`**

记录：

- 最近打开展示、记录、读取和旧模块已删除；
- 旧 localStorage 精确清理且其他偏好保留；
- 新导航回顶、后退/前进恢复、hash 定位和 `preventScroll`；
- 详情页陈旧响应回归仍通过；
- Chromium/WebKit 结果和精确命令；
- 当前 Git SHA；
- 未推送、未部署、未写生产数据。

- [ ] **Step 5: 提交进度**

```bash
git add PROGRESS.md
git commit -m "docs: record navigation scroll verification"
```

## 完成定义

只有同时满足以下条件，才能把本计划标记为“本地实现完成”：

- 全站布局不显示“最近打开”；
- route watcher、读写函数、旧辅助模块和对应样式均已删除；
- 旧 recent storage 键被精确清理，其他本地偏好不受影响；
- 新 route 默认回到顶部；
- 浏览器 back/forward 恢复各自历史滚动位置；
- hash 链接定位到锚点；
- `#main-content` 仍获得焦点，focus 不改变 router 决定的滚动；
- 顶部保持正常文档流，手动滚动时自然离开视口；
- 详情 A/B 同文档切换的陈旧响应隔离仍有 E2E 证据；
- Web 门禁和 Chromium/WebKit E2E 通过；
- `PROGRESS.md` 已随实现提交更新。
