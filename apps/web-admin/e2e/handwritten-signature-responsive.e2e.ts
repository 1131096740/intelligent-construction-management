import { expect, test, type Locator, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, { console: string[]; page: string[] }>();

test.beforeEach(async ({ page }) => {
  const errors = { console: [] as string[], page: [] as string[] };
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(page)!;
  expect(errors.page).toEqual([]);
  expect(errors.console.filter((message) => !(testInfo.title.includes("保存失败")
    && message.includes("503") && message.includes("Failed to load resource")))).toEqual([]);
});

async function openSignatureSettings(page: Page, availableActions = ["upload_canvas_signature", "create_canvas_signature_handoff"]) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const body = init?.body;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (body instanceof FormData && url.includes("/me/signature/")) {
        const file = body.get("file");
        if (file instanceof File) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          (window as typeof window & { __submittedSignature?: { type: string; size: number; dataUrl: string } })
            .__submittedSignature = { type: file.type, size: file.size, dataUrl };
        }
      }
      return originalFetch(input, init);
    };
  });
  await page.route("**/api/**", (route) => new URL(route.request().url()).pathname.startsWith("/api/")
    ? route.fulfill({ contentType: "application/json", body: "[]" })
    : route.continue());
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "employee-1", name: "测试员工", phone: "13800000001", mustChangePassword: false, roleKeys: ["employee"], globalRoleKeys: ["employee"] },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/signature/ticket", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/me/signature/canvas-capabilities", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ availableActions })
  }));
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13800000001");
  await page.getByPlaceholder("请输入密码").fill("Jgzg@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.goto("/系统配置");
  await expect(page.getByText("个人签名", { exact: true })).toBeVisible();
}

const signatureDialog = (page: Page) => page.getByRole("dialog", { name: "全屏手写签名", exact: true });

async function startSignatureWriting(page: Page) {
  await page.getByRole("button", { name: "全屏手写签名", exact: true }).click();
  const dialog = signatureDialog(page);
  const viewport = page.viewportSize()!;
  if (viewport.height > viewport.width) {
    await dialog.getByRole("button", { name: "开始签名", exact: true }).click();
  }
  await expect(dialog.getByLabel("横向手写签字板")).toBeVisible();
  return dialog;
}

async function canvasRotation(pad: Locator) {
  return pad.evaluate((element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const transform = getComputedStyle(current).transform;
      if (transform === "none") continue;
      const matrix = new DOMMatrixReadOnly(transform);
      if (Math.abs(matrix.a) < 0.01 && Math.abs(matrix.b - 1) < 0.01
        && Math.abs(matrix.c + 1) < 0.01 && Math.abs(matrix.d) < 0.01) return 90;
    }
    return 0;
  });
}

async function inkPixels(pad: Locator) {
  return pad.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 32) ink += 1;
    return ink;
  });
}

// Draw a deliberately asymmetric glyph using screen coordinates: a tall left
// stem, a short upper arm, and a long lower arm. A reversed or rotated export
// cannot satisfy the pixel assertions below.
async function drawAsymmetricSignature(page: Page, pad: Locator) {
  const dialog = signatureDialog(page);
  await expect(dialog.getByRole("button", { name: "取消签名", exact: true })).toBeFocused();
  await pad.click({ trial: true });
  const bounds = await pad.boundingBox();
  expect(bounds).not.toBeNull();
  const rotated = await canvasRotation(pad) === 90;
  const screenPoint = (x: number, y: number) => rotated
    ? { x: bounds!.x + (1 - y) * bounds!.width, y: bounds!.y + x * bounds!.height }
    : { x: bounds!.x + x * bounds!.width, y: bounds!.y + y * bounds!.height };
  for (const stroke of [
    [[0.2, 0.2], [0.2, 0.75], [0.75, 0.75]],
    [[0.2, 0.2], [0.42, 0.2]]
  ]) {
    const start = screenPoint(stroke[0][0], stroke[0][1]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const [x, y] of stroke.slice(1)) {
      const point = screenPoint(x, y);
      await page.mouse.move(point.x, point.y, { steps: 12 });
    }
    await page.mouse.up();
  }
  await expect.poll(() => inkPixels(pad)).toBeGreaterThan(100);
}

function pngFromMultipart(multipart: Buffer) {
  const start = multipart.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (start < 0) return null;
  for (let offset = start + 8; offset + 12 <= multipart.length;) {
    const length = multipart.readUInt32BE(offset);
    const type = multipart.toString("ascii", offset + 4, offset + 8);
    offset += length + 12;
    if (type === "IEND") return multipart.subarray(start, offset).toString("base64");
  }
  throw new Error("上传内容缺少完整 PNG 文件");
}

async function submittedPng(page: Page, multipart: Buffer) {
  const submitted = await page.evaluate(() => (window as typeof window & {
    __submittedSignature?: { type: string; size: number; dataUrl: string }
  }).__submittedSignature);
  expect(submitted?.type).toBe("image/png");
  expect(submitted!.size).toBeGreaterThan(100);
  const binary = pngFromMultipart(multipart);
  if (binary) expect(submitted!.dataUrl).toBe(`data:image/png;base64,${binary}`);
  // WebKit's interception protocol omits multipart file bytes; the File above
  // is captured from the unchanged FormData passed to the browser's real fetch.
  return submitted!.dataUrl;
}

async function assertUprightTransparentPng(page: Page, source: string) {
  const pixels = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1, ink = 0;
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] <= 32) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y); ink += 1;
    }
    let upperRight = 0, lowerRight = 0, upperMaxX = left;
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] <= 32) continue;
      if (y < top + (bottom - top) * 0.25) upperMaxX = Math.max(upperMaxX, x);
      if (x <= left + (right - left) * 0.55) continue;
      if (y < top + (bottom - top) * 0.5) upperRight += 1;
      else lowerRight += 1;
    }
    return {
      width: canvas.width, height: canvas.height, ink,
      left, top, rightPadding: canvas.width - right - 1, bottomPadding: canvas.height - bottom - 1,
      upperArmRatio: (upperMaxX - left) / (right - left),
      upperRightRatio: upperRight / ink, lowerRightRatio: lowerRight / ink,
      corners: [data[3], data[(canvas.width - 1) * 4 + 3],
        data[((canvas.height - 1) * canvas.width) * 4 + 3], data[data.length - 1]]
    };
  }, source);
  expect(pixels.width).toBeGreaterThan(pixels.height);
  expect(pixels.ink).toBeGreaterThan(100);
  expect(pixels.corners).toEqual([0, 0, 0, 0]);
  for (const padding of [pixels.left, pixels.top, pixels.rightPadding, pixels.bottomPadding]) {
    expect(padding).toBeGreaterThan(2);
    expect(padding).toBeLessThan(70);
  }
  expect(pixels.upperArmRatio).toBeGreaterThan(0.3);
  expect(pixels.upperArmRatio).toBeLessThan(0.6);
  expect(pixels.upperRightRatio).toBeLessThan(0.03);
  expect(pixels.lowerRightRatio).toBeGreaterThan(0.15);
  return pixels;
}

test("锁定竖屏先看正向引导，确认后再书写且示例不会进入签名 PNG", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  await page.getByRole("button", { name: "全屏手写签名", exact: true }).click();
  const dialog = signatureDialog(page);
  const guideHeading = dialog.getByRole("heading", { name: "先看清签名方向", exact: true });
  await expect(guideHeading).toBeVisible();
  expect(await canvasRotation(guideHeading)).toBe(0);
  await expect(dialog).toContainText("先点下方开始签名，再将手机向左转");
  await expect(dialog).toContainText("手机顶部朝左");
  await expect(dialog).toContainText("保持竖屏锁定即可");
  await expect(dialog.getByRole("img", { name: /手机顶部朝左/ })).toBeVisible();
  const pad = dialog.getByLabel("横向手写签字板");
  await expect(pad).toBeHidden();
  await expect(dialog.getByRole("button", { name: "预览签名", exact: true })).toBeHidden();
  await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-direction-guide.png` });

  await page.setViewportSize({ width: 844, height: 390 });
  const guideContent = dialog.locator(".jg-signature-editor__guide-content");
  await guideContent.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await guideContent.evaluate((element) => { element.scrollTop = 0; });
  const guideBounds = (await guideContent.boundingBox())!;
  const titleBounds = (await dialog.getByText("点击开始后，将手机顶部朝左横放", { exact: true }).boundingBox())!;
  expect(titleBounds.y).toBeGreaterThanOrEqual(guideBounds.y - 1);
  expect(titleBounds.y + titleBounds.height).toBeLessThanOrEqual(guideBounds.y + guideBounds.height + 1);
  const startBounds = (await dialog.getByRole("button", { name: "开始签名", exact: true }).boundingBox())!;
  expect(startBounds.x).toBeGreaterThanOrEqual(0);
  expect(startBounds.y).toBeGreaterThanOrEqual(0);
  expect(startBounds.x + startBounds.width).toBeLessThanOrEqual(844);
  expect(startBounds.y + startBounds.height).toBeLessThanOrEqual(390);
  await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-short-landscape-guide.png` });
  await page.setViewportSize({ width: 390, height: 844 });

  await dialog.getByRole("button", { name: "开始签名", exact: true }).click();
  await expect(guideHeading).toBeHidden();
  await expect(pad).toBeVisible();
  await expect.poll(() => canvasRotation(pad)).toBe(90);
  for (const cue of ["姓名顶部", "起笔", "从左向右"]) await expect(dialog).toContainText(cue);
  const sample = dialog.getByText("张三", { exact: true });
  await expect(sample).toBeVisible();
  expect(await sample.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(48);
  expect(await sample.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  expect(await inkPixels(pad)).toBe(0);
  await drawAsymmetricSignature(page, pad);
  await expect(sample).toBeHidden();
  const writtenInk = await inkPixels(pad);
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  const preview = dialog.getByAltText("待保存手写签名", { exact: true });
  await expect(preview).toBeVisible();
  expect(await canvasRotation(preview)).toBe(90);
  const previewCard = await preview.locator("..").evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight }));
  expect(previewCard.width).toBeLessThanOrEqual(640);
  expect(previewCard.height).toBeLessThanOrEqual(200);
  const exported = await assertUprightTransparentPng(page, (await preview.getAttribute("src"))!);
  expect(exported.ink).toBe(writtenInk);
});

test("手机横屏直接书写，大号示例和起笔方向可辨认", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openSignatureSettings(page);
  await expect(page.getByText("保持竖屏锁定，手机顶部朝左横拿，按姓名示例方向书写。", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "全屏手写签名", exact: true }).click();
  const dialog = signatureDialog(page);
  await expect(dialog.getByRole("heading", { name: "先看清签名方向", exact: true })).toBeHidden();
  await expect(dialog.getByRole("button", { name: "开始签名", exact: true })).toBeHidden();
  const pad = dialog.getByLabel("横向手写签字板");
  await expect(pad).toBeVisible();
  expect(await canvasRotation(pad)).toBe(0);
  for (const cue of ["姓名顶部", "起笔", "从左向右"]) await expect(dialog).toContainText(cue);
  await expect(dialog).not.toContainText("手机听筒端在左侧");
  await expect(dialog).toContainText("姓名底部");
  await expect(dialog.getByText("张三", { exact: true })).toBeVisible();
  expect(await inkPixels(pad)).toBe(0);
  await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-landscape-hints.png` });
  await drawAsymmetricSignature(page, pad);
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  await assertUprightTransparentPng(page, (await dialog.getByAltText("待保存手写签名").getAttribute("src"))!);
});

test("390px 竖屏可打开全屏手写签名", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  const dialog = await startSignatureWriting(page);
  await expect(dialog).toBeVisible();
  const pad = dialog.getByLabel("横向手写签字板");
  await expect(pad).toBeVisible();
  const firstVisible = await pad.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const panelBounds = element.closest('[role="dialog"]')!.getBoundingClientRect();
    const zoomAnimations: string[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      for (const animation of current.getAnimations()) {
        if (animation.playState !== "running" || !(animation.effect instanceof KeyframeEffect)) continue;
        if (animation.effect.getKeyframes().some((frame) => {
          const matrix = new DOMMatrixReadOnly(typeof frame.transform === "string" ? frame.transform : "none");
          return Math.abs(Math.hypot(matrix.a, matrix.b) - 1) > 0.001
            || Math.abs(Math.hypot(matrix.c, matrix.d) - 1) > 0.001;
        })) zoomAnimations.push((animation as CSSAnimation).animationName ?? "transform");
      }
    }
    return {
      zoomAnimations,
      fullScreen: Math.abs(panelBounds.x) < 1 && Math.abs(panelBounds.y) < 1
        && Math.abs(panelBounds.width - window.innerWidth) < 1
        && Math.abs(panelBounds.height - window.innerHeight) < 1,
      canvasAtFinalScale: Math.abs(bounds.width - element.clientHeight) < 1
        && Math.abs(bounds.height - element.clientWidth) < 1
    };
  });
  expect(firstVisible).toEqual({ zoomAnimations: [], fullScreen: true, canvasAtFinalScale: true });
  await expect.poll(() => canvasRotation(pad)).toBe(90);
  await expect(dialog).toContainText("姓名顶部");
  await expect(dialog).toContainText("从左向右");
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(388);
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeGreaterThanOrEqual(842);
  await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-portrait.png` });
  await dialog.getByRole("button", { name: "取消签名", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("个人签名", { exact: true })).toBeVisible();
});

test("844px 手机横屏仍保留直接手写入口", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openSignatureSettings(page);
  await expect(page.getByRole("button", { name: "全屏手写签名", exact: true })).toBeVisible();
  const pad = (await startSignatureWriting(page)).getByLabel("横向手写签字板");
  await expect(pad).toBeVisible();
  await expect.poll(() => canvasRotation(pad)).toBe(0);
});

test("竖屏真实坐标签名正常预览并上传一次透明裁边 PNG", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  let uploads = 0;
  let uploadedPng = "";
  let releaseUpload!: () => void;
  const uploadPending = new Promise<void>((resolve) => { releaseUpload = resolve; });
  await page.route("**/api/me/signature/canvas", async (route) => {
    uploads += 1;
    expect(await route.request().headerValue("content-type")).toContain("multipart/form-data");
    uploadedPng = await submittedPng(page, route.request().postDataBuffer()!);
    await uploadPending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ signatureFileId: "file-1", signatureVersionId: "version-1" }) });
  });
  const dialog = await startSignatureWriting(page);
  const pad = dialog.getByLabel("横向手写签字板");
  await expect(dialog.getByRole("button", { name: "预览签名", exact: true })).toBeDisabled();
  await drawAsymmetricSignature(page, pad);
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  const preview = dialog.getByAltText("待保存手写签名", { exact: true });
  await expect(preview).toBeVisible();
  await assertUprightTransparentPng(page, (await preview.getAttribute("src"))!);
  await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-preview.png` });
  await dialog.getByRole("button", { name: "返回重写", exact: true }).click();
  await expect(pad).toBeVisible();
  await expect.poll(() => inkPixels(pad)).toBeGreaterThan(100);
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  const save = dialog.getByRole("button", { name: "保存手写签名", exact: true });
  await save.click();
  await expect.poll(() => uploads).toBe(1);
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "取消签名", exact: true })).toBeDisabled();
  await save.dispatchEvent("click");
  expect(uploads).toBe(1);
  await assertUprightTransparentPng(page, uploadedPng);
  releaseUpload();
  await expect(page.getByText("手写签名已保存，将用于之后的审批。", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "全屏手写签名", exact: true })).toBeFocused();
  expect(uploads).toBe(1);
});

test("手机实际横竖屏切换不卸载签字板或丢失笔迹", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  const dialog = await startSignatureWriting(page);
  const pad = dialog.getByLabel("横向手写签字板");
  await drawAsymmetricSignature(page, pad);
  const writtenInk = await inkPixels(pad);
  await dialog.getByRole("button", { name: "查看握持方向", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "先看清签名方向", exact: true })).toBeVisible();
  await expect(pad).toBeHidden();
  await dialog.getByRole("button", { name: "开始签名", exact: true }).click();
  await expect(pad).toBeVisible();
  await expect.poll(() => inkPixels(pad)).toBe(writtenInk);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(dialog).toBeVisible();
  await expect(pad).toBeVisible();
  await expect.poll(() => canvasRotation(pad)).toBe(0);
  await expect.poll(() => inkPixels(pad)).toBeGreaterThan(100);
  await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-landscape.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => canvasRotation(pad)).toBe(90);
  await expect.poll(() => inkPixels(pad)).toBeGreaterThan(100);
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  await assertUprightTransparentPng(page, (await dialog.getByAltText("待保存手写签名").getAttribute("src"))!);
});

test("扫码手写使用同一全屏签字体验并通过原授权接口保存", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  let completions = 0;
  await page.route("**/api/me/signature/canvas-handoffs/opaque-token", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ expiresAt: "2099-07-23T09:05:00.000Z", completedAt: null, signatureVersionId: null, availableActions: ["complete_canvas_signature_handoff"] })
  }));
  await page.route("**/api/me/signature/canvas-handoffs/opaque-token/complete", async (route) => {
    completions += 1;
    expect(await route.request().headerValue("content-type")).toContain("multipart/form-data");
    await assertUprightTransparentPng(page, await submittedPng(page, route.request().postDataBuffer()!));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ signatureFileId: "file-1", signatureVersionId: "version-1" }) });
  });
  await page.goto("/手写签名?handoff=opaque-token");
  const dialog = await startSignatureWriting(page);
  await drawAsymmetricSignature(page, dialog.getByLabel("横向手写签字板"));
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  await dialog.getByRole("button", { name: "保存手写签名", exact: true }).click();
  await expect(page.getByText("手写签名已完成，请回到电脑端继续。", { exact: true })).toBeVisible();
  expect(completions).toBe(1);
});

test("服务端未授权上传时不显示直接签名入口", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page, ["create_canvas_signature_handoff"]);
  await expect(page.getByRole("button", { name: "全屏手写签名", exact: true })).toHaveCount(0);
  await page.route("**/api/me/signature/canvas-handoffs/opaque-denied", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ expiresAt: "2099-07-23T09:05:00.000Z", completedAt: null, signatureVersionId: null, availableActions: [] })
  }));
  const handoffRead = page.waitForResponse("**/api/me/signature/canvas-handoffs/opaque-denied");
  await page.goto("/手写签名?handoff=opaque-denied");
  await handoffRead;
  await expect(page.getByText("手机手写签名", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全屏手写签名", exact: true })).toHaveCount(0);
});

test("保存失败保留预览和笔迹，允许原接口重试", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  let uploads = 0;
  let firstPng = "";
  await page.route("**/api/me/signature/canvas", async (route) => {
    uploads += 1;
    const png = await submittedPng(page, route.request().postDataBuffer()!);
    if (uploads === 1) {
      firstPng = png;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "签名服务暂不可用，请稍后重试。" }) });
    }
    expect(png).toBe(firstPng);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ signatureFileId: "file-2", signatureVersionId: "version-2" }) });
  });
  const dialog = await startSignatureWriting(page);
  await drawAsymmetricSignature(page, dialog.getByLabel("横向手写签字板"));
  await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
  const preview = dialog.getByAltText("待保存手写签名");
  const previewSource = await preview.getAttribute("src");
  await dialog.getByRole("button", { name: "保存手写签名", exact: true }).click();
  await expect.poll(() => uploads).toBe(1);
  await expect(dialog.getByText("签名未保存，笔迹已保留。签名服务暂不可用，请稍后重试。", { exact: true })).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", previewSource!);
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(dialog.getByRole("button", { name: "保存手写签名", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "保存手写签名", exact: true }).click();
  await expect(page.getByText("手写签名已保存，将用于之后的审批。", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(uploads).toBe(2);
});

test("键盘打开后焦点留在签名弹窗，取消时返回入口", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSignatureSettings(page);
  const launcher = page.getByRole("button", { name: "全屏手写签名", exact: true });
  await launcher.focus();
  await launcher.press("Enter");
  const dialog = signatureDialog(page);
  const cancel = dialog.getByRole("button", { name: "取消签名", exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const start = dialog.getByRole("button", { name: "开始签名", exact: true });
  await expect(start).toBeFocused();
  const enterTransition = page.locator(".t-dialog-zoom__vue-enter-active").filter({ has: dialog });
  await expect(enterTransition).toHaveCount(0);
  await expect(start).toBeFocused();
  await start.press("Enter");
  await expect(cancel).toBeFocused();
  await drawAsymmetricSignature(page, dialog.getByLabel("横向手写签字板"));
  await cancel.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "预览签名", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "查看握持方向", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "重写", exact: true })).toBeFocused();
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await cancel.focus();
  await cancel.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }]) {
  test(`${viewport.width}×${viewport.height} 竖屏能在可见画布签名并正向预览`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openSignatureSettings(page);
    const dialog = await startSignatureWriting(page);
    const pad = dialog.getByLabel("横向手写签字板");
    if (viewport.width === 320) {
      const sample = dialog.getByText("张三", { exact: true });
      const startCue = dialog.getByText("起笔 →", { exact: true });
      await expect(sample).toBeVisible();
      await expect(startCue).toBeVisible();
      const sampleBounds = (await sample.boundingBox())!;
      const cueBounds = (await startCue.boundingBox())!;
      const overlapX = Math.min(sampleBounds.x + sampleBounds.width, cueBounds.x + cueBounds.width)
        - Math.max(sampleBounds.x, cueBounds.x);
      const overlapY = Math.min(sampleBounds.y + sampleBounds.height, cueBounds.y + cueBounds.height)
        - Math.max(sampleBounds.y, cueBounds.y);
      expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-320-empty.png` });
    }
    await drawAsymmetricSignature(page, pad);
    const bounds = (await pad.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.screenshot({ scale: "css", path: `/private/tmp/jgzg-signature-${testInfo.project.name}-${viewport.width}x${viewport.height}.png` });
    await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
    const preview = dialog.getByAltText("待保存手写签名");
    await expect(preview).toBeVisible();
    await assertUprightTransparentPng(page, (await preview.getAttribute("src"))!);
    if (viewport.width === 320) {
      await dialog.getByRole("button", { name: "返回重写", exact: true }).click();
      await dialog.getByRole("button", { name: "重写", exact: true }).click();
      expect(await inkPixels(pad)).toBe(0);
      await expect(dialog.getByText("张三", { exact: true })).toBeVisible();
    }
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}×${viewport.height} 实际书写面积覆盖视口`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openSignatureSettings(page);
    const dialog = await startSignatureWriting(page);
    const pad = dialog.getByLabel("横向手写签字板");
    await pad.click({ trial: true });
    const canvas = (await pad.boundingBox())!;
    const dashedFrame = (await pad.locator("..").boundingBox())!;
    const longSide = Math.max(canvas.width, canvas.height);
    const shortSide = Math.min(canvas.width, canvas.height);
    const viewportLongSide = Math.max(viewport.width, viewport.height);
    const viewportShortSide = Math.min(viewport.width, viewport.height);
    const coverage = canvas.width * canvas.height / (viewport.width * viewport.height);
    const measurement = { viewport, canvas, dashedFrame, longSide, shortSide, coverage };
    console.log("signature-writing-area", JSON.stringify(measurement));
    await testInfo.attach("writing-area", { body: JSON.stringify(measurement, null, 2), contentType: "application/json" });
    await page.screenshot({ scale: "css", path: testInfo.outputPath("writing-area.png") });
    expect.soft(longSide).toBeGreaterThanOrEqual(viewportLongSide - 100);
    expect.soft(shortSide).toBeGreaterThanOrEqual(viewportShortSide - 32);
    expect.soft(coverage).toBeGreaterThanOrEqual(0.7);
  });
}
