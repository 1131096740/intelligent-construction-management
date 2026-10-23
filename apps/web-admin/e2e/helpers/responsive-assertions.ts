import { expect, type Locator, type Page } from "@playwright/test";

export async function expectBusinessContentWithinViewport(page: Page) {
  const clipped = await page.locator("#main-content").evaluate((root) => {
    const boundary = root.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>("h1,h2,h3,p,label,button,input,textarea,iframe,dt,dd")]
      .filter((element) => {
        if (element.closest(".t-table__content,.jg-workspace-scroll,.jg-document-preview__versions,.t-tabs__nav-scroll,revo-grid")) return false;
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" &&
          (bounds.left < boundary.left - 1 || bounds.right > boundary.right + 1);
      })
      .map((element) => `${element.tagName}.${element.className}: ${element.textContent?.trim().slice(0, 40)}`);
  });
  expect(clipped).toEqual([]);
}

export async function expectNoDocumentHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

export async function expectNoNestedHorizontalScrollers(page: Page) {
  const nested = await page.evaluate(() => {
    const activeScrollers = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
      const overflow = getComputedStyle(element).overflowX;
      return (overflow === "auto" || overflow === "scroll") && element.scrollWidth > element.clientWidth + 1;
    });

    return activeScrollers.flatMap((element) =>
      activeScrollers.some((candidate) => candidate !== element && candidate.contains(element))
        ? [element.className || element.tagName]
        : []
    );
  });

  expect(nested).toEqual([]);
}

export async function expectHorizontalScrollOwner(locator: Locator) {
  const result = await locator.evaluate((element) => {
    const node = element as HTMLElement;
    const start = node.scrollLeft;
    node.scrollLeft = Math.min(80, Math.max(0, node.scrollWidth - node.clientWidth));
    const changed = node.scrollLeft !== start;
    node.scrollLeft = start;
    return { changed, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });

  expect(result.scrollWidth).toBeGreaterThan(result.clientWidth);
  expect(result.changed).toBe(true);
}

export async function expectHorizontalScrollOwnerIfNeeded(locator: Locator) {
  await expect(locator).toBeVisible();
  const overflowing = await locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  if (overflowing) await expectHorizontalScrollOwner(locator);
}
