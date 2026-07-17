import { expect, type Locator, type Page } from "@playwright/test";

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
