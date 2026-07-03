<template>
  <section class="takeover-page">
    <div class="page-head">
      <div>
        <h1>历史合同接管</h1>
        <p>已签在执行历史合同的基础信息、历史余额快照和接管确认台账</p>
      </div>
      <t-space>
        <t-button @click="loadTakeovers">
          刷新
        </t-button>
        <t-button
          theme="primary"
          @click="showCreateForm = !showCreateForm"
        >
          新增接管合同
        </t-button>
      </t-space>
    </div>

    <div class="toolbar">
      <label class="project-picker">
        <span>项目</span>
        <select
          v-model="selectedProjectId"
          :disabled="loadingProjects || projects.length === 0"
          @change="loadTakeovers"
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
      <div
        v-for="item in summaryValues"
        :key="item.label"
        class="summary-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="`tone-${item.tone}`">{{ item.value }}</strong>
      </div>
    </div>

    <div
      v-if="message"
      :class="['list-message', messageTone]"
    >
      {{ message }}
    </div>

    <t-card
      v-if="showCreateForm"
      class="panel"
      title="新增历史合同接管"
      :bordered="true"
    >
      <div class="form-section">
        <h2>合同基础信息</h2>
        <div class="form-grid">
          <label>
            <span>合同编号</span>
            <t-input
              v-model="createForm.code"
              placeholder="HT-LS-2026-001"
            />
          </label>
          <label>
            <span>合同名称</span>
            <t-input
              v-model="createForm.name"
              placeholder="材料采购历史合同"
            />
          </label>
          <label>
            <span>相对方</span>
            <t-input
              v-model="createForm.counterparty"
              placeholder="供应商/分包单位"
            />
          </label>
          <label>
            <span>我方签约主体</span>
            <t-input
              v-model="createForm.companyEntityName"
              placeholder="可选"
            />
          </label>
          <label>
            <span>合同金额（元）</span>
            <t-input
              v-model="createForm.amountYuan"
              placeholder="1000000.00"
            />
          </label>
          <label>
            <span>签订日期</span>
            <input
              v-model="createForm.signedAt"
              type="date"
            >
          </label>
          <label>
            <span>接管等级</span>
            <select v-model="createForm.takeoverLevel">
              <option
                v-for="option in takeoverLevelOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>履约状态</span>
            <select v-model="createForm.lifecycleStatus">
              <option
                v-for="option in lifecycleStatusOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
        <label class="wide-field">
          <span>付款条款原文摘要</span>
          <t-textarea
            v-model="createForm.paymentTermsOriginalText"
            placeholder="可粘贴原合同付款条款摘要"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </label>
      </div>

      <div class="form-section">
        <h2>历史余额快照</h2>
        <div class="form-grid">
          <label
            v-for="field in moneyFields"
            :key="field.key"
          >
            <span>{{ field.label }}（元）</span>
            <t-input
              v-model="createForm[field.key]"
              placeholder="0.00"
            />
          </label>
        </div>
        <div class="form-grid two">
          <label>
            <span>余额来源说明</span>
            <t-textarea
              v-model="createForm.balanceSourceSummary"
              placeholder="如财务台账、项目台账、合同部核对结果"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label>
            <span>证据说明</span>
            <t-textarea
              v-model="createForm.evidenceSummary"
              placeholder="如已归档合同、对账单、付款凭证清单"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
        </div>
      </div>

      <div class="form-actions">
        <t-button
          theme="primary"
          :loading="creating"
          @click="submitCreate"
        >
          保存接管草稿
        </t-button>
        <t-button @click="showCreateForm = false">
          取消
        </t-button>
      </div>
    </t-card>

    <div class="content-grid">
      <t-card
        class="panel ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="contractTakeoverColumns"
          :data="tableRows"
          :loading="loadingTakeovers"
          empty="暂无历史合同接管记录"
        >
          <template #takeoverStatusLabel="{ row }">
            <t-tag
              size="small"
              :theme="statusTagTheme(row.takeoverStatusTone)"
              variant="light"
            >
              {{ row.takeoverStatusLabel }}
            </t-tag>
          </template>
          <template #operation="{ row }">
            <t-space size="small">
              <t-link
                theme="primary"
                @click="selectTakeover(row.takeover)"
              >
                详情
              </t-link>
              <t-link
                v-if="canSubmitTakeoverReview(row.takeover)"
                theme="primary"
                @click="submitReview(row.takeover)"
              >
                提交复核
              </t-link>
              <t-link
                v-if="canConfirmTakeover(row.takeover)"
                theme="danger"
                @click="openConfirm(row.takeover)"
              >
                确认接管
              </t-link>
            </t-space>
          </template>
        </t-table>
      </t-card>

      <t-card
        class="panel detail-panel"
        title="接管详情"
        :bordered="true"
      >
        <div
          v-if="selectedRow"
          class="detail-body"
        >
          <div class="detail-title">
            <strong>{{ selectedRow.contractNo }}</strong>
            <span>{{ selectedRow.contractName }}</span>
          </div>

          <dl class="detail-list">
            <div
              v-for="item in selectedBaseInfo"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>

          <h3>历史余额</h3>
          <dl class="detail-list money">
            <div
              v-for="item in selectedBalanceInfo"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>

          <h3>来源与确认</h3>
          <dl class="detail-list">
            <div>
              <dt>余额来源</dt>
              <dd>{{ selectedRow.takeover.balanceSourceSummary || "未填写" }}</dd>
            </div>
            <div>
              <dt>证据说明</dt>
              <dd>{{ selectedRow.takeover.evidenceSummary || "未填写" }}</dd>
            </div>
            <div>
              <dt>提交时间</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.submittedAt) }}</dd>
            </div>
            <div>
              <dt>接管确认时间</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.confirmedAt) }}</dd>
            </div>
            <div>
              <dt>余额确认时间</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.historicalBalanceConfirmedAt) }}</dd>
            </div>
          </dl>
        </div>
        <div
          v-else
          class="empty-detail"
        >
          请选择一条历史合同接管记录
        </div>
      </t-card>
    </div>

    <t-dialog
      v-model:visible="confirmVisible"
      header="确认历史合同接管"
      :confirm-btn="{ content: '确认接管', loading: confirming }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="confirmSelectedTakeover"
      @close="closeConfirm"
    >
      <div class="confirm-body">
        <p>
          {{ confirmTarget ? `${confirmTarget.contractNo} 将进入已接管状态。` : "" }}
        </p>
        <label>
          <span>当前登录密码</span>
          <t-input
            v-model="confirmationPassword"
            type="password"
            autocomplete="current-password"
            placeholder="请输入当前登录密码"
          />
        </label>
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  confirmContractTakeover,
  createContractTakeover,
  fetchProjects,
  getContractTakeover,
  listContractTakeovers,
  submitContractTakeoverReview,
  type ContractLifecycleStatus,
  type ContractTakeoverLevel,
  type ContractTakeoverReadModel,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  canConfirmTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  contractTakeoverColumns,
  formatTakeoverDate,
  lifecycleStatusLabel,
  lifecycleStatusOptions,
  takeoverLevelLabel,
  takeoverLevelOptions,
  toContractTakeoverTableRow,
  takeoverStatusLabel,
  yuanToCents,
  type ContractTakeoverTableRow,
  type ContractTakeoverTone
} from "./contract-takeover.config";

type MoneyFieldKey =
  | "historicalSettledYuan"
  | "historicalApprovalPendingPaymentYuan"
  | "historicalApprovedPendingPaymentYuan"
  | "historicalPaidYuan"
  | "historicalProxyPaidYuan"
  | "historicalAdvancePaidYuan"
  | "historicalAdvanceDeductedYuan"
  | "historicalRetentionWithheldYuan"
  | "historicalRetentionReleasedYuan"
  | "otherConfirmedOccupancyYuan";

interface CreateFormState extends Record<MoneyFieldKey, string> {
  code: string;
  name: string;
  counterparty: string;
  companyEntityName: string;
  amountYuan: string;
  signedAt: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText: string;
  balanceSourceSummary: string;
  evidenceSummary: string;
}

const moneyFields: Array<{ key: MoneyFieldKey; label: string }> = [
  { key: "historicalSettledYuan", label: "历史累计结算" },
  { key: "historicalApprovalPendingPaymentYuan", label: "历史审批中付款" },
  { key: "historicalApprovedPendingPaymentYuan", label: "历史已批待付" },
  { key: "historicalPaidYuan", label: "历史累计已付" },
  { key: "historicalProxyPaidYuan", label: "历史总包代付" },
  { key: "historicalAdvancePaidYuan", label: "历史预付款已付" },
  { key: "historicalAdvanceDeductedYuan", label: "历史预付款已扣回" },
  { key: "historicalRetentionWithheldYuan", label: "历史质保金扣留" },
  { key: "historicalRetentionReleasedYuan", label: "历史质保金释放" },
  { key: "otherConfirmedOccupancyYuan", label: "其他确认占用" }
];

const projects = ref<ProjectOptionReadModel[]>([]);
const takeovers = ref<ContractTakeoverReadModel[]>([]);
const selectedProjectId = ref("");
const selectedTakeoverId = ref("");
const loadingProjects = ref(false);
const loadingTakeovers = ref(false);
const creating = ref(false);
const confirming = ref(false);
const showCreateForm = ref(false);
const confirmVisible = ref(false);
const confirmTarget = ref<ContractTakeoverReadModel | null>(null);
const confirmationPassword = ref("");
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const createForm = reactive<CreateFormState>(createEmptyForm());

const tableRows = computed(() =>
  takeovers.value.map((takeover) => toContractTakeoverTableRow(takeover))
);

const selectedRow = computed<ContractTakeoverTableRow | null>(
  () => tableRows.value.find((row) => row.id === selectedTakeoverId.value) ?? null
);

const summaryValues = computed(() => {
  const counts = {
    total: takeovers.value.length,
    draft: 0,
    pending_review: 0,
    confirmed: 0,
    needs_supplement: 0
  };
  for (const takeover of takeovers.value) {
    if (takeover.takeoverStatus in counts) {
      counts[takeover.takeoverStatus as keyof typeof counts] += 1;
    }
  }

  return [
    { label: "全部", value: String(counts.total), tone: "default" as const },
    { label: "草稿", value: String(counts.draft), tone: "default" as const },
    { label: "待复核", value: String(counts.pending_review), tone: "warning" as const },
    { label: "已接管", value: String(counts.confirmed), tone: "success" as const },
    { label: "待补充", value: String(counts.needs_supplement), tone: "primary" as const }
  ];
});

const selectedBaseInfo = computed(() => {
  const row = selectedRow.value;
  if (!row) {
    return [];
  }
  return [
    { label: "合同编号", value: row.contractNo },
    { label: "合同名称", value: row.contractName },
    { label: "相对方", value: row.counterparty },
    { label: "合同金额", value: row.amount },
    { label: "签订日期", value: row.signedAt },
    { label: "接管等级", value: takeoverLevelLabel(row.takeoverLevel) },
    { label: "接管状态", value: takeoverStatusLabel(row.takeoverStatus) },
    { label: "履约状态", value: lifecycleStatusLabel(row.lifecycleStatus) }
  ];
});

const selectedBalanceInfo = computed(() => {
  const takeover = selectedRow.value?.takeover;
  if (!takeover) {
    return [];
  }
  return [
    { label: "历史累计结算", value: centsToYuanText(takeover.historicalSettledCents) },
    {
      label: "历史审批中付款",
      value: centsToYuanText(takeover.historicalApprovalPendingPaymentCents)
    },
    {
      label: "历史已批待付",
      value: centsToYuanText(takeover.historicalApprovedPendingPaymentCents)
    },
    { label: "历史累计已付", value: centsToYuanText(takeover.historicalPaidCents) },
    { label: "历史总包代付", value: centsToYuanText(takeover.historicalProxyPaidCents) },
    { label: "历史预付款已付", value: centsToYuanText(takeover.historicalAdvancePaidCents) },
    {
      label: "历史预付款已扣回",
      value: centsToYuanText(takeover.historicalAdvanceDeductedCents)
    },
    {
      label: "历史质保金扣留",
      value: centsToYuanText(takeover.historicalRetentionWithheldCents)
    },
    {
      label: "历史质保金释放",
      value: centsToYuanText(takeover.historicalRetentionReleasedCents)
    },
    { label: "其他确认占用", value: centsToYuanText(takeover.otherConfirmedOccupancyCents) }
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
      await loadTakeovers();
    } else {
      setMessage("暂无可用项目", "default");
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "加载项目失败", "danger");
  } finally {
    loadingProjects.value = false;
  }
}

async function loadTakeovers() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    takeovers.value = [];
    selectedTakeoverId.value = "";
    return;
  }

  loadingTakeovers.value = true;
  message.value = "";
  try {
    const nextTakeovers = await listContractTakeovers(projectId);
    takeovers.value = nextTakeovers;
    if (!nextTakeovers.some((takeover) => takeover.id === selectedTakeoverId.value)) {
      selectedTakeoverId.value = "";
    }
  } catch (error) {
    takeovers.value = [];
    selectedTakeoverId.value = "";
    setMessage(error instanceof Error ? error.message : "加载历史合同接管列表失败", "danger");
  } finally {
    loadingTakeovers.value = false;
  }
}

async function selectTakeover(takeover: ContractTakeoverReadModel) {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  selectedTakeoverId.value = takeover.id;
  try {
    const detail = await getContractTakeover(projectId, takeover.id);
    takeovers.value = takeovers.value.map((item) => (item.id === detail.id ? detail : item));
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "加载接管详情失败", "danger");
  }
}

async function submitCreate() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  creating.value = true;
  message.value = "";
  try {
    const created = await createContractTakeover(projectId, {
      code: requiredText(createForm.code, "合同编号"),
      name: requiredText(createForm.name, "合同名称"),
      counterparty: requiredText(createForm.counterparty, "相对方"),
      companyEntityName: createForm.companyEntityName.trim() || undefined,
      amountCents: yuanToCents(createForm.amountYuan, "合同金额"),
      signedAt: requiredText(createForm.signedAt, "签订日期"),
      takeoverLevel: createForm.takeoverLevel,
      lifecycleStatus: createForm.lifecycleStatus,
      paymentTermsOriginalText: requiredText(
        createForm.paymentTermsOriginalText,
        "付款条款原文摘要"
      ),
      historicalSettledCents: moneyCents("historicalSettledYuan"),
      historicalApprovalPendingPaymentCents: moneyCents("historicalApprovalPendingPaymentYuan"),
      historicalApprovedPendingPaymentCents: moneyCents("historicalApprovedPendingPaymentYuan"),
      historicalPaidCents: moneyCents("historicalPaidYuan"),
      historicalProxyPaidCents: moneyCents("historicalProxyPaidYuan"),
      historicalAdvancePaidCents: moneyCents("historicalAdvancePaidYuan"),
      historicalAdvanceDeductedCents: moneyCents("historicalAdvanceDeductedYuan"),
      historicalRetentionWithheldCents: moneyCents("historicalRetentionWithheldYuan"),
      historicalRetentionReleasedCents: moneyCents("historicalRetentionReleasedYuan"),
      otherConfirmedOccupancyCents: moneyCents("otherConfirmedOccupancyYuan"),
      balanceSourceSummary: requiredText(createForm.balanceSourceSummary, "余额来源说明"),
      evidenceSummary: requiredText(createForm.evidenceSummary, "证据说明")
    });
    resetCreateForm();
    showCreateForm.value = false;
    selectedTakeoverId.value = created.id;
    setMessage("历史合同接管草稿已保存", "success");
    await loadTakeovers();
    await selectTakeover(created);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "保存历史合同接管失败", "danger");
  } finally {
    creating.value = false;
  }
}

async function submitReview(takeover: ContractTakeoverReadModel) {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  try {
    const updated = await submitContractTakeoverReview(projectId, takeover.id);
    takeovers.value = takeovers.value.map((item) => (item.id === updated.id ? updated : item));
    selectedTakeoverId.value = updated.id;
    setMessage("已提交业务复核", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "提交复核失败", "danger");
  }
}

function openConfirm(takeover: ContractTakeoverReadModel) {
  confirmTarget.value = takeover;
  confirmationPassword.value = "";
  confirmVisible.value = true;
}

function closeConfirm() {
  if (!confirming.value) {
    confirmTarget.value = null;
    confirmationPassword.value = "";
  }
}

async function confirmSelectedTakeover() {
  const target = confirmTarget.value;
  const projectId = selectedProjectId.value;
  if (!target) {
    return;
  }
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  confirming.value = true;
  try {
    const updated = await confirmContractTakeover(projectId, target.id, {
      confirmationPassword: requiredText(confirmationPassword.value, "当前登录密码")
    });
    takeovers.value = takeovers.value.map((item) => (item.id === updated.id ? updated : item));
    selectedTakeoverId.value = updated.id;
    confirmVisible.value = false;
    confirmTarget.value = null;
    confirmationPassword.value = "";
    setMessage("历史合同已确认接管，后续付款容量将扣减历史余额", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "确认接管失败", "danger");
  } finally {
    confirming.value = false;
  }
}

function resetCreateForm() {
  Object.assign(createForm, createEmptyForm());
}

function createEmptyForm(): CreateFormState {
  return {
    code: "",
    name: "",
    counterparty: "",
    companyEntityName: "",
    amountYuan: "",
    signedAt: todayText(),
    takeoverLevel: "B",
    lifecycleStatus: "in_progress",
    paymentTermsOriginalText: "",
    historicalSettledYuan: "",
    historicalApprovalPendingPaymentYuan: "",
    historicalApprovedPendingPaymentYuan: "",
    historicalPaidYuan: "",
    historicalProxyPaidYuan: "",
    historicalAdvancePaidYuan: "",
    historicalAdvanceDeductedYuan: "",
    historicalRetentionWithheldYuan: "",
    historicalRetentionReleasedYuan: "",
    otherConfirmedOccupancyYuan: "",
    balanceSourceSummary: "",
    evidenceSummary: ""
  };
}

function moneyCents(key: MoneyFieldKey) {
  return yuanToCents(createForm[key], moneyFields.find((field) => field.key === key)?.label ?? "金额", {
    allowZero: true
  });
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`请填写${label}`);
  }

  return value;
}

function statusTagTheme(tone: ContractTakeoverTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}

function setMessage(text: string, tone: "success" | "danger" | "default") {
  message.value = text;
  messageTone.value = tone;
}

function todayText(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
</script>

<style scoped>
.takeover-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
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

.toolbar,
.list-message,
.panel {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) repeat(5, minmax(86px, 1fr));
  gap: 12px;
  align-items: end;
  padding: 12px;
  margin-bottom: 16px;
}

.project-picker,
.form-section label,
.confirm-body label {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.project-picker span,
.form-section label span,
.confirm-body label span {
  color: #565f6d;
  font-size: 12px;
  font-weight: 600;
}

select,
input[type="date"] {
  width: 100%;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #d2d8e1;
  border-radius: 3px;
  background: #fff;
  color: #151922;
}

.summary-item {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.summary-item span {
  color: #767f8d;
  font-size: 12px;
}

.summary-item strong {
  font-size: 18px;
  line-height: 1.2;
}

.tone-default {
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

.tone-danger {
  color: #b51d2a;
}

.list-message {
  margin-bottom: 16px;
  padding: 10px 12px;
  color: #424955;
  font-size: 12px;
  font-weight: 600;
}

.list-message.success {
  color: #1b6b3a;
  background: #f2fbf5;
}

.list-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.panel {
  margin-bottom: 16px;
  overflow: hidden;
}

:deep(.t-card__body) {
  overflow-x: auto;
}

.form-section {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}

.form-section h2,
.detail-panel h3 {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.form-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.wide-field {
  display: grid;
  gap: 6px;
}

.form-actions {
  display: flex;
  gap: 10px;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.8fr);
  gap: 16px;
  align-items: start;
}

.ledger-panel {
  min-width: 0;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

.detail-panel {
  min-width: 0;
}

.detail-body {
  display: grid;
  gap: 14px;
}

.detail-title {
  display: grid;
  gap: 4px;
}

.detail-title strong {
  font-size: 16px;
}

.detail-title span,
.empty-detail,
.confirm-body p {
  color: #5f6673;
}

.detail-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.detail-list div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 10px;
}

.detail-list.money div {
  grid-template-columns: minmax(116px, 1fr) minmax(0, 1fr);
}

.detail-list dt {
  color: #767f8d;
  font-size: 12px;
}

.detail-list dd {
  min-width: 0;
  margin: 0;
  color: #151922;
  overflow-wrap: anywhere;
}

.empty-detail {
  min-height: 120px;
  display: grid;
  place-items: center;
  font-size: 13px;
}

.confirm-body {
  display: grid;
  gap: 12px;
}

.confirm-body p {
  margin: 0;
}

@media (max-width: 1180px) {
  .toolbar,
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .project-picker {
    grid-column: span 2;
  }

  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .page-head,
  .toolbar,
  .form-grid,
  .form-grid.two,
  .detail-list div,
  .detail-list.money div {
    grid-template-columns: 1fr;
  }

  .page-head {
    display: grid;
  }

  .project-picker {
    grid-column: auto;
  }

  .form-actions {
    flex-wrap: wrap;
  }
}
</style>
