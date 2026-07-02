<template>
  <section class="project-operating-page">
    <div class="page-head">
      <div>
        <h1>项目经营</h1>
        <p>只汇总当前系统已有合同、结算、付款和财务出账数据</p>
      </div>
      <label class="project-picker">
        <span>项目</span>
        <select
          v-model="selectedProjectId"
          :disabled="loadingProjects || projects.length === 0"
          @change="loadOverview"
        >
          <option
            v-for="project in projects"
            :key="project.id"
            :value="project.id"
          >
            {{ project.code }} · {{ project.name }}
          </option>
        </select>
      </label>
    </div>

    <div
      v-if="message"
      class="message"
    >
      {{ message }}
    </div>
    <div
      v-else-if="loadingOverview"
      class="message"
    >
      正在加载项目经营数据
    </div>

    <template v-if="overview">
      <div class="summary-strip">
        <div
          v-for="item in summaryItems"
          :key="item.label"
          class="summary-item"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>

      <div class="overview-grid">
        <section class="panel">
          <h2>现金口径</h2>
          <dl>
            <div
              v-for="item in cashItems"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </section>

        <section class="panel">
          <h2>经营口径</h2>
          <dl>
            <div
              v-for="item in businessItems"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="gap-panel">
        <h2>数据缺口</h2>
        <ul>
          <li
            v-for="gap in overview.dataGaps"
            :key="gap"
          >
            {{ gap }}
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  fetchProjectOperatingOverview,
  fetchProjects,
  type ProjectOperatingOverviewReadModel,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";

const projects = ref<ProjectOptionReadModel[]>([]);
const overview = ref<ProjectOperatingOverviewReadModel | null>(null);
const selectedProjectId = ref("");
const loadingProjects = ref(false);
const loadingOverview = ref(false);
const message = ref("");

const summaryItems = computed(() => {
  const counts = overview.value?.counts ?? { contracts: 0, settlements: 0, payments: 0 };
  return [
    { label: "合同", value: String(counts.contracts) },
    { label: "结算", value: String(counts.settlements) },
    { label: "付款", value: String(counts.payments) },
    { label: "可用资金", value: formatCents(overview.value?.cash.availableFundsCents ?? null) }
  ];
});

const cashItems = computed(() => {
  const cash = overview.value?.cash;
  return [
    { label: "实际收款", value: formatCents(cash?.actualReceiptsCents ?? null) },
    { label: "可用资金", value: formatCents(cash?.availableFundsCents ?? null) },
    { label: "已实付", value: formatCents(cash?.actualPaidCents ?? 0) },
    { label: "审批中预占", value: formatCents(cash?.approvalPendingOccupancyCents ?? 0) },
    { label: "已批待付款", value: formatCents(cash?.approvedPendingPaymentCents ?? 0) },
    { label: "财务已记出账", value: formatCents(cash?.financeRecordedOutflowCents ?? 0) }
  ];
});

const businessItems = computed(() => {
  const business = overview.value?.business;
  return [
    { label: "生效合同额", value: formatCents(business?.effectiveContractAmountCents ?? 0) },
    { label: "生效结算额", value: formatCents(business?.effectiveSettlementAmountCents ?? 0) },
    { label: "结算可付额", value: formatCents(business?.payableSettlementAmountCents ?? 0) },
    { label: "经营收入", value: formatCents(business?.operatingIncomeCents ?? null) },
    { label: "经营成本", value: formatCents(business?.operatingCostCents ?? null) },
    { label: "毛利", value: formatCents(business?.grossProfitCents ?? null) }
  ];
});

onMounted(loadProjects);

async function loadProjects() {
  loadingProjects.value = true;
  message.value = "";
  try {
    projects.value = await fetchProjects();
    selectedProjectId.value = projects.value[0]?.id ?? "";
    if (selectedProjectId.value) {
      await loadOverview();
    } else {
      message.value = "暂无可用项目";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载项目失败";
  } finally {
    loadingProjects.value = false;
  }
}

async function loadOverview() {
  const projectId = selectedProjectId.value;
  overview.value = null;
  if (!projectId) {
    overview.value = null;
    return;
  }

  loadingOverview.value = true;
  message.value = "";
  try {
    const nextOverview = await fetchProjectOperatingOverview(projectId);
    if (selectedProjectId.value === projectId) {
      overview.value = nextOverview;
    }
  } catch (error) {
    if (selectedProjectId.value === projectId) {
      overview.value = null;
      message.value = error instanceof Error ? error.message : "加载项目经营数据失败";
    }
  } finally {
    if (selectedProjectId.value === projectId) {
      loadingOverview.value = false;
    }
  }
}

function formatCents(value: number | null): string {
  if (value === null) {
    return "暂无数据";
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY"
  }).format(value / 100);
}
</script>

<style scoped>
.project-operating-page {
  display: grid;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 22px;
}

h2 {
  font-size: 15px;
}

p,
dt,
.project-picker span,
.message,
.gap-panel li {
  color: #5f6673;
}

.project-picker {
  display: grid;
  gap: 6px;
  min-width: 280px;
}

select {
  height: 32px;
  border: 1px solid #cfd7e3;
  border-radius: 4px;
  padding: 0 10px;
  background: #fff;
}

.summary-strip,
.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.overview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-item,
.panel,
.gap-panel {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  padding: 16px;
}

.summary-item {
  display: grid;
  gap: 8px;
}

.summary-item strong {
  font-size: 20px;
}

dl {
  display: grid;
  gap: 10px;
  margin: 14px 0 0;
}

dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #edf0f5;
}

dd {
  margin: 0;
  font-weight: 600;
}

.gap-panel ul {
  margin: 12px 0 0;
  padding-left: 18px;
}

.message {
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
}

@media (max-width: 900px) {
  .page-head,
  dl div {
    display: grid;
  }

  .project-picker {
    min-width: 0;
  }

  .summary-strip,
  .overview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
