<template>
  <section class="contract-page">
    <div class="page-head">
      <div>
        <h1>合同台账</h1>
        <p>合同、合同版本、付款条款版本、归档状态统一台账</p>
      </div>
      <t-button
        theme="primary"
        @click="showCreateForm = !showCreateForm"
      >
        新建合同
      </t-button>
    </div>

    <t-card
      v-if="showCreateForm"
      class="create-panel"
      title="新建合同草稿"
      :bordered="true"
    >
      <div class="create-grid">
        <t-input
          v-model="createForm.projectId"
          label="项目ID"
          placeholder="项目ID"
        />
        <t-input
          v-model="createForm.code"
          label="合同编号"
          placeholder="HT-2026-002"
        />
        <t-input
          v-model="createForm.name"
          label="合同名称"
          placeholder="钢材采购补充合同"
        />
        <t-input
          v-model="createForm.counterparty"
          label="相对方"
          placeholder="供应商名称"
        />
        <t-select
          v-model="createForm.companyEntityId"
          label="我方主体"
          placeholder="选择签约我方公司主体"
          clearable
        >
          <t-option
            v-for="entity in companyEntities"
            :key="entity.id"
            :value="entity.id"
            :label="entity.name"
          />
        </t-select>
        <t-input
          v-model="createForm.amountCents"
          label="合同金额(分)"
          placeholder="128000000"
        />
        <t-input
          v-model="createForm.paymentTermsOriginalText"
          class="wide-field"
          label="付款条款原文"
          placeholder="结算归档确认生效后30天内支付80%，20%作为质保金。"
        />
        <t-input
          v-model="createForm.stageName"
          label="首条付款阶段"
          placeholder="当期结算款"
        />
        <t-input
          v-model="createForm.stageRatioBps"
          label="付款比例(BPS)"
          placeholder="8000"
        />
        <t-input
          v-model="createForm.stageDueDays"
          label="账期(天)"
          placeholder="30"
        />
        <t-input
          v-model="createForm.stageTriggerEvent"
          class="wide-field"
          label="触发条件"
          placeholder="结算归档确认生效"
        />
      </div>
      <div class="create-actions">
        <t-button
          theme="primary"
          :loading="createBusy"
          @click="submitCreateContract"
        >
          创建草稿
        </t-button>
        <t-button @click="showCreateForm = false">
          取消
        </t-button>
      </div>
      <div
        v-if="createMessage"
        :class="['create-message', createMessageTone]"
      >
        {{ createMessage }}
      </div>
    </t-card>

    <div class="summary-strip">
      <div
        v-for="item in contractSummaryItems"
        :key="item.label"
        class="summary-item"
      >
        <span class="summary-label">{{ item.label }}</span>
        <strong :class="['summary-value', `tone-${item.tone}`]">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="filter-bar">
      <label
        v-for="field in contractFilterFields"
        :key="field.key"
        :class="['filter-field', { keyword: field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          :placeholder="field.placeholder"
          size="small"
          readonly
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
        @click="showNotice('当前台账为静态种子数据，查询条件接后端列表接口后生效。')"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        @click="showNotice('筛选条件已保持为空；后端列表接口接入后可重置真实查询。')"
      >
        重置
      </t-button>
    </div>

    <div
      v-if="noticeMessage"
      class="list-message"
    >
      {{ noticeMessage }}
    </div>

    <t-card
      class="ledger-panel"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="contractLedgerColumns"
        :data="contractLedgerRows"
        empty="暂无合同数据"
      >
        <template #currentNode="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.nodeTone)"
            variant="light"
          >
            {{ row.currentNode }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            详情
          </t-link>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createContractDraft,
  fetchCompanyEntities,
  type CompanyEntityReadModel
} from "../../api/core-flow-read.api";
import type { ContractStatusTone } from "./contract-list.config";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractLedgerRows,
  contractSummaryItems
} from "./contract-list.config";

const router = useRouter();
const showCreateForm = ref(false);
const createBusy = ref(false);
const createMessage = ref("");
const createMessageTone = ref<"success" | "danger">("success");
const noticeMessage = ref("");
const companyEntities = ref<CompanyEntityReadModel[]>([]);
const createForm = reactive({
  projectId: "seed-project-jgxm-001",
  code: `HT-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  name: "",
  counterparty: "",
  companyEntityId: "",
  amountCents: "",
  paymentTermsOriginalText: "结算归档确认生效后30天内支付80%，20%作为质保金。",
  stageName: "当期结算款",
  stageRatioBps: "8000",
  stageDueDays: "30",
  stageTriggerEvent: "结算归档确认生效"
});

onMounted(async () => {
  try {
    companyEntities.value = await fetchCompanyEntities();
  } catch {
    // 公司主体字典加载失败不阻断建单，选择项留空即可。
  }
});

function openDetail(contractId: string) {
  void router.push(`/contracts/${contractId}`);
}

function showNotice(message: string) {
  noticeMessage.value = message;
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label}不能为空`);
  }

  return value;
}

function positiveInteger(raw: string, label: string) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}必须为正整数`);
  }

  return value;
}

async function submitCreateContract() {
  createBusy.value = true;
  createMessage.value = "";

  try {
    const result = await createContractDraft({
      projectId: requiredText(createForm.projectId, "项目ID"),
      code: requiredText(createForm.code, "合同编号"),
      name: requiredText(createForm.name, "合同名称"),
      counterparty: requiredText(createForm.counterparty, "相对方"),
      companyEntityId: createForm.companyEntityId || undefined,
      amountCents: positiveInteger(createForm.amountCents, "合同金额"),
      paymentTermsOriginalText: requiredText(createForm.paymentTermsOriginalText, "付款条款原文"),
      paymentStages: [
        {
          name: requiredText(createForm.stageName, "首条付款阶段"),
          basis: "current_settlement",
          ratioBps: positiveInteger(createForm.stageRatioBps, "付款比例"),
          triggerEvent: requiredText(createForm.stageTriggerEvent, "触发条件"),
          dueDays: positiveInteger(createForm.stageDueDays, "账期"),
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true,
          originalText: createForm.paymentTermsOriginalText
        }
      ]
    });

    createMessageTone.value = "success";
    createMessage.value = "合同草稿已创建。";
    await router.push(`/contracts/${result.contract.code}`);
  } catch (error) {
    createMessageTone.value = "danger";
    createMessage.value = error instanceof Error ? error.message : "创建合同失败";
  } finally {
    createBusy.value = false;
  }
}

function statusTagTheme(tone: ContractStatusTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.contract-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.summary-strip {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.create-panel {
  margin-bottom: 16px;
  border-radius: 3px;
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.wide-field {
  grid-column: span 2;
}

.create-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.create-message {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}

.create-message.success {
  color: #1b6b3a;
  background: #f3faf5;
}

.create-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.list-message {
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
  color: #424955;
  font-size: 12px;
  font-weight: 600;
}

.summary-item {
  display: flex;
  gap: 10px;
  padding-right: 24px;
  margin-right: 22px;
  border-right: 1px solid #dce1e8;
}

.summary-item:last-child {
  border-right: 0;
}

.summary-label {
  color: #767f8d;
}

.summary-value {
  color: #151922;
}

.tone-primary {
  color: #0052cc;
}

.tone-warning {
  color: #9f4f06;
}

.tone-success {
  color: #1b6b3a;
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(96px, 120px)) minmax(150px, 1fr) 76px 76px;
  gap: 8px 10px;
  align-items: end;
  padding: 10px 12px;
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.filter-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.filter-field span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.filter-action {
  width: 76px;
  min-width: 76px;
}

.ledger-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: 3px;
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@media (max-width: 900px) {
  .create-grid,
  .filter-bar {
    grid-template-columns: repeat(4, minmax(120px, 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }
}
</style>
