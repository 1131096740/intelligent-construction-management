import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import ContractWorkbenchSectionNav from "./ContractWorkbenchSectionNav.vue";

describe("ContractWorkbenchSectionNav", () => {
  it("renders all ten anchors and marks the active section", async () => {
    const html = await renderToString(createSSRApp(ContractWorkbenchSectionNav, {
      activeId: "bill_tax"
    }));

    expect(html.match(/data-section-nav-id=/gu)).toHaveLength(10);
    expect(html).toContain('href="#contract-workbench-section-bill_tax"');
    expect(html).toMatch(
      /class="section-link active"[^>]*aria-current="location"[^>]*data-section-nav-id="bill_tax"/u
    );
  });

  it("uses one select event instead of changing page state internally", async () => {
    const html = await renderToString(createSSRApp(ContractWorkbenchSectionNav, {
      activeId: "inspection"
    }));

    expect(html).toContain('aria-label="合同资料章节"');
    expect(ContractWorkbenchSectionNav.emits).toContain("select");
  });
});
