/// <reference path="../../src/env.d.ts" />
// Local browser regression fixture; not imported by the production app.
import { createApp, defineComponent, h, ref } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import SettlementLineAttachmentPanel from "../../src/pages/settlements/components/SettlementLineAttachmentPanel.vue";
import ProjectOperatingTakeoverPage from "../../src/pages/projects/ProjectOperatingTakeoverPage.vue";
import ExpenseClaimDetailPage from "../../src/pages/expense-claims/ExpenseClaimDetailPage.vue";
import GeneralProcurementDetailPage from "../../src/pages/general-procurement/GeneralProcurementDetailPage.vue";
const kind = new URLSearchParams(location.search).get("kind");
const settlement = defineComponent({ setup() { const revision = ref(1); return () => h(SettlementLineAttachmentPanel, {
  projectId: "project-1", draftId: "draft-1", revision: revision.value, lines: [{ lineKey: "line-1", label: "现场施工明细" }], onUpdated: (value: number) => { revision.value = value; }
}); } });
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: "/settlement", component: settlement }, { path: "/operating", component: ProjectOperatingTakeoverPage },
  { path: "/expense/:claimId", component: ExpenseClaimDetailPage }, { path: "/procurement/:procurementId", component: GeneralProcurementDetailPage },
  { path: "/费用与报销工作台", component: { render: () => h("div", "已返回费用列表") } },
  { path: "/综合采购申请", component: { render: () => h("div", "已返回采购列表") } }
] });
await router.push(kind === "expense" ? "/expense/claim-1" : kind === "procurement" ? "/procurement/procurement-1" : `/${kind}`);
createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(TDesign).mount("#app");
