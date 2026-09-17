import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import ContractBasicSection from "./ContractBasicSection.vue";
import ContractProfessionalFieldsSection from "./ContractProfessionalFieldsSection.vue";

describe("合同基础信息统一字段展示", () => {
  it("使用后台字段的中文名称和填写提示渲染基础表单", async () => {
    const definition: BusinessEntrySceneDefinition = {
      key: "contract_basic", entityType: "contract_version", version: 1,
      name: "合同基础信息", description: "合同基础信息", rules: [],
      fields: [{
        key: "contractName", label: "合同业务名称", description: "按合同填写", example: "材料采购",
        type: "text", scope: "header", unit: "", precision: 0, required: true,
        permissions: { view: ["contract_staff"], edit: ["contract_staff"] },
        bulk: { enabled: false, strategy: "replace" },
        excel: { column: "合同业务名称", paste: "single", errorLocation: "cell" },
        display: { formHint: "按本次合同资料填写名称", gridColumn: "合同业务名称", mobilePriority: 1, readonlyText: "合同名称" }
      }]
    };
    const app = createSSRApp(ContractBasicSection, {
      mode: "basic", model: { contractName: "材料采购", companyEntityId: "" },
      disabled: false, definition,
      settlementMode: { value: null, confirmationRequired: false, canConfirm: false }
    });
    app.component("t-input", { props: ["placeholder"], template: '<input :placeholder="placeholder" />' });
    app.component("t-select", { template: "<select />" });
    app.component("t-alert", { template: "<aside />" });
    app.component("t-button", { template: "<button />" });
    app.component("t-textarea", { template: "<textarea />" });
    app.component("t-date-picker", { template: "<input />" });
    const html = await renderToString(app);
    expect(html).toContain("合同业务名称");
    expect(html).toContain("按本次合同资料填写名称");
  });

  it("专业字段使用服务器精确模板定义而非重新解释原始模板", async () => {
    const app = createSSRApp(ContractProfessionalFieldsSection, {
      model: { fieldValues: { location: "合成仓库" } }, disabled: false,
      workbench: {
        contract: { contractTypeKey: "material_purchase" },
        version: { templateSnapshot: { fieldSchema: [] } },
        templateEntry: { values: { location: "合成仓库" }, definition: {
          key: "contract_template_fields", entityType: "contract_version", version: 3,
          source: { kind: "contract_business_template_version", id: "exact-version", version: 3 },
          name: "合同模板字段", description: "精确模板版本", rules: [],
          fields: [{ key: "location", label: "本版本交货地点", type: "text", scope: "header",
            description: "填写交货地点", example: "合成仓库", unit: "", precision: 0, required: true,
            permissions: { view: ["contract_staff"], edit: ["contract_staff"] },
            bulk: { enabled: false, strategy: "replace" },
            excel: { column: "交货地点", paste: "single", errorLocation: "cell" },
            display: { formHint: "按精确模板填写地点", gridColumn: "交货地点", mobilePriority: 1, readonlyText: "已提交地点" }
          }]
        } }
      }
    });
    for (const name of ["t-input", "t-textarea", "t-date-picker", "t-select"]) {
      app.component(name, { props: ["placeholder"], template: '<input :placeholder="placeholder" />' });
    }
    const html = await renderToString(app);
    expect(html).toContain("本版本交货地点");
    expect(html).toContain("按精确模板填写地点");
  });
});
