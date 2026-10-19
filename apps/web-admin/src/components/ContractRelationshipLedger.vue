<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute,useRouter } from "vue-router";
import { CONTRACT_RELATIONSHIP_LABELS, type ContractRelationship, type ContractLedgerSection, type ContractRelationshipLedger } from "@jiangkong/shared-domain";
import { useAuthStore } from "../auth/auth.store";
import { fetchContractClassificationPreflight,fetchContractRelationshipLedger, exportContractRelationshipLedger } from "../api/contract-relationship-ledger.api";
import { fetchProjects } from "../api/core-flow-read.api";
import { formatUnknownApiError } from "../api/error-message";
import { centsTextToYuanText } from "../lib/money";
import ContractBankVerificationPanel from "./ContractBankVerificationPanel.vue";
import UpwardReceiptMatchPanel from "./UpwardReceiptMatchPanel.vue";
import UpwardContractAmountPanel from "./UpwardContractAmountPanel.vue";
import ContractProxyExecutionPanel from "./ContractProxyExecutionPanel.vue";
import ContractFinancialBalances from "./ContractFinancialBalances.vue";
import ContractEconomicReviewPanel from "./ContractEconomicReviewPanel.vue";
import AffiliateCompanyContractPanel from "../pages/projects/components/AffiliateCompanyContractPanel.vue";
import AffiliateBusinessLedgerPanel from "../pages/projects/components/AffiliateBusinessLedgerPanel.vue";

const props = withDefaults(defineProps<{ projectId?: string; initialSection?: ContractLedgerSection }>(), { projectId: "", initialSection: "contracts" });
const router = useRouter();
const auth = useAuthStore();
const route=useRoute();
const routeSection=String(route.query.ledgerSection??"");
const section = ref<ContractLedgerSection>(["contracts","settlements","payments","receipts"].includes(routeSection)?routeSection as ContractLedgerSection:props.initialSection);
const selectedProject = ref(props.projectId||String(route.query.projectId??""));
const selectedCompany = ref("");
const exporting = ref(false);
const preflight=ref<Awaited<ReturnType<typeof fetchContractClassificationPreflight>>|null>(null),checking=ref(false);
let inspection = 0;
async function inspectHistory(){const current=++inspection;checking.value=true;error.value="";try{const result=await fetchContractClassificationPreflight(selectedProject.value);if(alive&&current===inspection)preflight.value=result;}catch(cause){if(alive&&current===inspection)error.value=formatUnknownApiError(cause,"预检失败");}finally{if(alive&&current===inspection)checking.value=false;}}
const asOf = ref(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
const page = ref(1);
const relationship = ref<ContractRelationship | "">("");
const projects = ref<Array<{ label: string; value: string }>>([]);
const data = ref<ContractRelationshipLedger | null>(null);
const busy = ref(false);
const error = ref("");
const showHandling = ref(false);
const handling = ref<"outside" | "upward" | "upward_settlement">("outside");
let generation = 0;
let alive = true;
const canReadReceipts = computed(() => (auth.user?.roleKeys ?? []).some((role) => ["finance_staff", "finance_director", "chairman", "general_manager", "project_manager", "super_admin"].includes(role)));
const sections = computed(() => [
  { label: "合同承诺", value: "contracts" }, { label: "确认结算", value: "settlements" },
  { label: "实际付款", value: "payments" }, ...(canReadReceipts.value ? [{ label: "收款与拨款", value: "receipts" }] : [])
]);
const classes = [{ label: "全部分类（分别小计）", value: "" }, ...Object.entries(CONTRACT_RELATIONSHIP_LABELS).map(([value, label]) => ({ value, label }))];
const columns = [
  { colKey: "relationshipLabel", title: "合同分类", width: 180 },
  { colKey: "projectName", title: "项目", width: 160 },
  { colKey: "reference", title: "业务编号/期间", width: 180 },
  { colKey: "signingParty", title: "签约/原债务主体", width: 180 },
  { colKey: "counterparty", title: "相对方", width: 180 },
  { colKey: "amountCents", title: "本类金额（元）", width: 150 },
  { colKey: "actualPayer", title: "实际付款方", width: 180 },
  { colKey: "accountingEffect", title: "经营影响", width: 250 },
  { colKey: "operation", title: "查看办理", width: 110 }
];
function amount(value: string | null) { return value === null ? "未定/待确认金额" : centsTextToYuanText(value); }
async function load() {
  const request = ++generation;
  data.value = null; error.value = ""; busy.value = true; page.value = 1;
  try {
    const result = await fetchContractRelationshipLedger({ section: section.value, asOf: asOf.value,
      ...(selectedProject.value ? { projectId: selectedProject.value } : {}),
      ...(relationship.value ? { relationship: relationship.value } : {}),
      ...(selectedCompany.value ? { companyEntityId: selectedCompany.value } : {}) });
    if (alive && generation === request) data.value = result;
  } catch (cause) {
    if (alive && generation === request) error.value = formatUnknownApiError(cause, "分类台账读取失败，请重试");
  } finally { if (alive && generation === request) busy.value = false; }
}
async function download() {
  exporting.value = true;
  try {
    const blob = await exportContractRelationshipLedger({ section: section.value, asOf: asOf.value, projectId: selectedProject.value, relationship: relationship.value || undefined, companyEntityId: selectedCompany.value });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "签约关系分类台账.xlsx"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { error.value = formatUnknownApiError(cause, "分类台账导出失败"); }
  finally { exporting.value = false; }
}
function onPageChange(info: { current: number }) { page.value = info.current; }
function handle(type: "outside" | "upward" | "upward_settlement") { handling.value = type; showHandling.value = true; }
watch(() => props.projectId, (id) => { selectedProject.value = id; showHandling.value = false; });
watch([selectedProject, section, relationship, selectedCompany, asOf], () => { inspection++; checking.value=false; preflight.value=null; showHandling.value = false; void load(); });
onMounted(async () => {
  void load();
  if (!props.projectId) try {
    const result = await fetchProjects();
    if (alive) projects.value = result.map((p) => ({ label: p.name, value: p.id }));
  } catch (cause) { if (alive) error.value = formatUnknownApiError(cause, "项目范围读取失败，请刷新"); }
});
onBeforeUnmount(() => { alive = false; generation += 1; });
</script>

<template>
  <section
    class="relationship-ledger"
    aria-label="签约关系分类台账"
  >
    <h2>签约关系分类台账</h2>
    <p>表内、表外纳入真实下游成本；对上保留主体往来。付款方变化不改变合同分类。</p>
    <div class="relationship-ledger__filters">
      <t-select
        v-if="!props.projectId"
        v-model="selectedProject"
        aria-label="分类台账所属项目"
        :options="[{ label: '全部授权项目', value: '' }, ...projects]"
      />
      <t-select
        v-model="section"
        aria-label="分类台账种类"
        :options="sections"
      />
      <t-select
        v-model="relationship"
        aria-label="合同分类筛选"
        :options="classes"
      />
      <t-select
        v-model="selectedCompany"
        aria-label="我方公司分账筛选"
        :options="[{ label: '全部我方公司及施工企业', value: '' }, ...(data?.companies ?? []).map((c) => ({ label: c.name, value: c.id }))]"
      />
      <t-date-picker
        v-model="asOf"
        aria-label="统计基准日"
        :allow-input="false"
      />
      <t-button
        variant="outline"
        :loading="busy"
        @click="load"
      >
        刷新
      </t-button>
      <t-button
        variant="outline"
        :loading="exporting"
        :disabled="busy || !data"
        @click="download"
      >
        导出当前分类范围
      </t-button>
    </div>
    <UpwardReceiptMatchPanel
      v-if="selectedProject && section==='receipts' && (auth.user?.roleKeys??[]).some(r=>['finance_staff','finance_director'].includes(r))"
      :project-id="selectedProject"
      @changed="load"
    />
    <ContractBankVerificationPanel
      v-if="selectedProject && (auth.user?.roleKeys??[]).some(r=>['finance_staff','finance_director'].includes(r))"
      :project-id="selectedProject"
      @changed="load"
    />
    <ContractProxyExecutionPanel
      v-if="selectedProject && (auth.user?.roleKeys ?? []).some(role=>['finance_staff','finance_director'].includes(role))"
      :project-id="selectedProject"
      @changed="load"
    />
    <ContractFinancialBalances
      v-if="canReadReceipts"
      :key="data?.readAt"
      :project-id="selectedProject"
      :company-entity-id="selectedCompany"
      :as-of="asOf"
    />
    <section
      v-if="selectedProject && (auth.user?.roleKeys??[]).some(role=>['contract_director','budget_director','finance_director','project_manager','chairman','general_manager'].includes(role))"
      aria-label="历史口径只读预检"
    >
      <t-button
        variant="outline"
        :loading="checking"
        @click="inspectHistory"
      >
        历史口径只读预检
      </t-button>
      <template v-if="preflight">
        <p>{{ preflight.notice }}</p><p>已检经营事实 {{ preflight.checkedFacts }} 条；尚未形成经营事实的正式来源 {{ preflight.unprojectedFormalSources }} 条；缺相对方档案 {{ preflight.unclassifiedExternalDocuments }} 份；待专业复核 {{ preflight.pendingEconomicReviews }} 项。</p><article
          v-for="(item,index) in preflight.differences"
          :key="index"
        >
          <strong>{{ item.relationship }} · {{ item.reference }} · {{ item.status }}</strong><p>原金额 {{ amount(item.beforeAmountCents) }} 元；候选口径 {{ amount(item.afterAmountCents) }} 元。{{ item.reason }}</p>
        </article>
      </template>
    </section>
    <UpwardContractAmountPanel
      v-if="selectedProject && section==='contracts'"
      :project-id="selectedProject"
      @changed="load"
    />
    <ContractEconomicReviewPanel
      v-if="selectedProject && section === 'contracts'"
      :project-id="selectedProject"
      @changed="load"
    />
    <div
      v-if="selectedProject"
      class="relationship-ledger__actions"
    >
      <t-button
        variant="outline"
        @click="handle('outside')"
      >
        表外合同、结算及付款办理
      </t-button>
      <t-button
        variant="outline"
        @click="handle('upward')"
      >
        对上合同登记与核对
      </t-button>
      <t-button
        variant="outline"
        @click="handle('upward_settlement')"
      >
        对上结算办理
      </t-button>
      <t-button
        variant="text"
        @click="router.push({ path: '/合同工作台/新建', query: { projectId: selectedProject } })"
      >
        表内合同办理
      </t-button>
    </div>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <template v-if="data">
      <p>{{ data.notice }}</p>
      <p>统计基准日：{{ data.asOf }} · 读取时间：{{ new Date(data.readAt).toLocaleString('zh-CN') }} · 金额单位：元</p>
      <div class="relationship-ledger__totals">
        <div
          v-for="total in data.totals"
          :key="total.relationship"
        >
          <strong>{{ total.label }}</strong>
          <span>{{ amount(total.knownAmountCents) }} 元 · {{ total.count }} 条</span>
          <span v-if="total.unknownAmountCount">另有 {{ total.unknownAmountCount }} 条未定/待确认金额</span>
        </div>
      </div>
      <t-table
        class="relationship-ledger__desktop"
        :data="data.rows"
        :columns="columns"
        row-key="id"
        size="small"
        :loading="busy"
        :pagination="{ current: page, pageSize: 10, total: data.rows.length }"
        @page-change="onPageChange"
      >
        <template #amountCents="{ row }">
          {{ amount(row.amountCents) }}
          <small v-if="row.documentAmountCents">（原文书 {{ amount(row.documentAmountCents) }} 元）</small>
        </template>
        <template #actualPayer="{ row }">
          {{ row.actualPayer ?? '不适用' }}
        </template>
        <template #operation="{ row }">
          <t-button
            variant="text"
            size="small"
            @click="router.push(row.detailPath)"
          >
            原业务办理
          </t-button>
        </template>
      </t-table>
      <div class="relationship-ledger__mobile">
        <article
          v-for="row in data.rows.slice((page - 1) * 10, page * 10)"
          :key="row.id"
        >
          <strong>{{ row.relationshipLabel }} · {{ row.statusLabel }}</strong>
          <p>{{ row.projectName }} · {{ row.reference }}</p>
          <p>签约/原债务主体：{{ row.signingParty }}<br>相对方：{{ row.counterparty }}</p>
          <p>{{ row.amountLabel }}：{{ amount(row.amountCents) }} 元</p>
          <p v-if="row.documentAmountCents">
            原文书金额：{{ amount(row.documentAmountCents) }} 元
          </p>
          <p v-if="row.actualPayer">
            实际付款方：{{ row.actualPayer }}
          </p>
          <p>{{ row.accountingEffect }}</p>
          <t-button
            variant="text"
            @click="router.push(row.detailPath)"
          >
            查看原业务
          </t-button>
        </article>
        <t-pagination
          v-model:current="page"
          :page-size="10"
          :total="data.rows.length"
          :show-page-size="false"
          size="small"
        />
      </div>
      <p v-if="!data.rows.length">
        当前授权范围及筛选条件下没有已确认记录；不代表全部历史资料已接管。
      </p>
    </template>
    <t-drawer
      v-model:visible="showHandling"
      header="分类业务办理"
      size="90%"
      :footer="false"
    >
      <AffiliateCompanyContractPanel
        v-if="showHandling && handling === 'upward'"
        :project-id="selectedProject"
      />
      <AffiliateBusinessLedgerPanel
        v-if="showHandling && handling !== 'upward'"
        :project-id="selectedProject"
        :start-with-upward-settlement="handling === 'upward_settlement'"
      />
    </t-drawer>
  </section>
</template>

<style scoped>
.relationship-ledger { padding: var(--jg-space-4, 16px); border: 1px solid var(--jg-border); border-radius: var(--jg-radius-md, 8px); margin-block: var(--jg-space-4, 16px); min-width: 0; }
.relationship-ledger__filters, .relationship-ledger__actions, .relationship-ledger__totals { display: flex; flex-wrap: wrap; gap: var(--jg-space-3, 12px); margin-block: var(--jg-space-3, 12px); }
.relationship-ledger__filters > :deep(.t-select__wrap) { width: 230px; max-width: 100%; }
.relationship-ledger__totals > div { display: flex; flex-direction: column; gap: var(--jg-space-2, 8px); padding: var(--jg-space-3, 12px); background: var(--jg-surface-secondary); }
.relationship-ledger :deep(.t-table) { max-width: 100%; overflow-x: auto; }
.relationship-ledger__mobile { display: none; }
@media (max-width: 640px) {
  .relationship-ledger { box-sizing: border-box; width: 100%; max-width: calc(100vw - 32px); overflow-wrap: anywhere; }
  .relationship-ledger__totals > div { box-sizing: border-box; width: 100%; min-width: 0; }
  .relationship-ledger__actions :deep(.t-button) { max-width: 100%; height: auto; min-height: var(--jg-control-height-md, 32px); white-space: normal; }
  .relationship-ledger__desktop { display: none; }
  .relationship-ledger__mobile { display: block; }
  .relationship-ledger__mobile article { border-bottom: 1px solid var(--jg-border); padding-block: var(--jg-space-3, 12px); overflow-wrap: anywhere; }
  .relationship-ledger__filters > :deep(.t-select__wrap) { width: 100%; }
}
</style>
