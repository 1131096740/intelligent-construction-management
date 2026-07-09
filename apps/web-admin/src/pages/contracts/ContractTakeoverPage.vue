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
        <t-button @click="showPrecheckPanel = !showPrecheckPanel">
          导入预检
        </t-button>
        <t-button
          theme="primary"
          @click="startCreate"
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
      v-if="showPrecheckPanel"
      class="panel import-panel"
      title="历史合同导入预检"
      :bordered="true"
    >
      <div class="form-section">
        <label class="wide-field">
          <span>导入行</span>
          <t-textarea
            v-model="importPrecheckText"
            :placeholder="importPrecheckPlaceholder"
            :autosize="{ minRows: 5, maxRows: 10 }"
          />
        </label>
      </div>
      <div class="form-actions">
        <t-button
          theme="primary"
          :loading="prechecking"
          @click="submitImportPrecheck"
        >
          预检
        </t-button>
        <t-button @click="clearImportPrecheck">
          清空
        </t-button>
      </div>
      <div
        v-if="importPrecheckResult"
        class="precheck-summary"
      >
        <div
          v-for="item in precheckSummaryValues"
          :key="item.label"
          class="summary-item"
        >
          <span>{{ item.label }}</span>
          <strong :class="`tone-${item.tone}`">{{ item.value }}</strong>
        </div>
      </div>
      <t-table
        v-if="importPrecheckResult"
        row-key="rowNo"
        size="small"
        class="precheck-table"
        :columns="importPrecheckColumns"
        :data="importPrecheckRows"
      >
        <template #statusLabel="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.statusTone)"
            variant="light"
          >
            {{ row.statusLabel }}
          </t-tag>
        </template>
        <template #issuesText="{ row }">
          <span :class="row.hasErrors ? 'issue-danger' : 'issue-muted'">
            {{ row.issuesText }}
          </span>
        </template>
      </t-table>
    </t-card>

    <t-card
      v-if="showCreateForm"
      class="panel"
      :title="editingTakeoverId ? '编辑历史合同接管草稿' : '新增历史合同接管'"
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
            <span>接管截止日</span>
            <input
              v-model="createForm.takeoverCutoffDate"
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
            <span>接管责任人</span>
            <t-input
              v-model="createForm.responsibleUserId"
              placeholder="填写责任人姓名或账号备注"
            />
          </label>
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
          <label>
            <span>复核意见</span>
            <t-textarea
              v-model="createForm.reviewComment"
              placeholder="记录合同部、预算、项目、财务复核意见"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label>
            <span>验收结论</span>
            <t-textarea
              v-model="createForm.acceptanceConclusion"
              placeholder="记录是否可作为后续结算付款依据"
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
          {{ editingTakeoverId ? "保存修改" : "保存接管草稿" }}
        </t-button>
        <t-button @click="cancelEdit">
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
                v-if="canEditTakeover(row.takeover)"
                theme="primary"
                @click="startEdit(row.takeover)"
              >
                编辑
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

          <h3>接管资料</h3>
          <div class="evidence-uploader">
            <label>
              <span>资料类型</span>
              <select v-model="evidencePurpose">
                <option
                  v-for="option in evidencePurposeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span>资料文件</span>
              <input
                ref="evidenceInputRef"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                @change="onEvidenceFileChange"
              >
            </label>
            <t-button
              theme="primary"
              variant="outline"
              :loading="evidenceUploading"
              :disabled="!canEditTakeover(selectedRow.takeover) || !evidenceFile"
              @click="submitEvidenceFile"
            >
              上传接管资料
            </t-button>
          </div>
          <EvidenceFileCards :files="selectedEvidenceFiles" />

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
              <dt>接管截止日</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.takeoverCutoffDate) }}</dd>
            </div>
            <div>
              <dt>接管责任人</dt>
              <dd>{{ selectedRow.takeover.responsibleUserId || "未填写" }}</dd>
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
            <div>
              <dt>复核意见</dt>
              <dd>{{ selectedRow.takeover.reviewComment || "未填写" }}</dd>
            </div>
            <div>
              <dt>验收结论</dt>
              <dd>{{ selectedRow.takeover.acceptanceConclusion || "未填写" }}</dd>
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
  attachContractTakeoverEvidenceFile,
  confirmContractTakeover,
  createContractTakeover,
  fetchProjects,
  getContractTakeover,
  listContractTakeovers,
  precheckContractTakeoverImport,
  submitContractTakeoverReview,
  updateContractTakeover,
  uploadPrivateFile,
  type ContractTakeoverImportPrecheckReadModel,
  type ContractTakeoverEvidencePurpose,
  type ContractLifecycleStatus,
  type ContractTakeoverLevel,
  type ContractTakeoverReadModel,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import {
  canConfirmTakeover,
  canEditTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  contractTakeoverColumns,
  formatTakeoverDate,
  lifecycleStatusLabel,
  lifecycleStatusOptions,
  parseContractTakeoverImportPrecheckRows,
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
  takeoverCutoffDate: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText: string;
  balanceSourceSummary: string;
  evidenceSummary: string;
  responsibleUserId: string;
  reviewComment: string;
  acceptanceConclusion: string;
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
const prechecking = ref(false);
const editingTakeoverId = ref("");
const confirming = ref(false);
const evidenceUploading = ref(false);
const showCreateForm = ref(false);
const showPrecheckPanel = ref(false);
const confirmVisible = ref(false);
const confirmTarget = ref<ContractTakeoverReadModel | null>(null);
const confirmationPassword = ref("");
const evidencePurpose = ref<ContractTakeoverEvidencePurpose>("historical_contract_scan");
const evidenceFile = ref<File | null>(null);
const evidenceInputRef = ref<HTMLInputElement | null>(null);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const createForm = reactive<CreateFormState>(createEmptyForm());
const importPrecheckText = ref("");
const importPrecheckResult = ref<ContractTakeoverImportPrecheckReadModel | null>(null);

const importPrecheckPlaceholder = [
  "合同编号\t合同名称\t相对方\t我方主体\t合同金额(元)\t签订日期\t接管等级\t履约状态\t付款条款\t历史累计结算(元)\t历史审批中付款(元)\t历史已批待付(元)\t历史累计已付(元)\t历史总包代付(元)\t历史预付款已付(元)\t历史预付款已扣回(元)\t历史质保金扣留(元)\t历史质保金释放(元)\t其他确认占用(元)\t余额来源\t证据说明\t资料清单\t问题清单",
  "HT-LS-2026-001\t材料采购历史合同\t历史供应商\t建工集团\t1000000.00\t2026-01-01\tB\tin_progress\t按月结算付款\t600000.00\t0\t20000.00\t300000.00\t0\t0\t0\t0\t0\t0\t财务台账核对\t合同扫描件已归档\t合同扫描件、历史结算台账、付款凭证\t发票待补，财务负责"
].join("\n");

const importPrecheckColumns = [
  { colKey: "rowNo", title: "行号", width: 72 },
  { colKey: "code", title: "合同编号", width: 140 },
  { colKey: "name", title: "合同名称", minWidth: 180 },
  { colKey: "counterparty", title: "相对方", minWidth: 140 },
  { colKey: "amount", title: "合同金额", width: 116, align: "right" },
  { colKey: "evidenceChecklist", title: "资料清单", minWidth: 180 },
  { colKey: "issueSummary", title: "问题清单", minWidth: 180 },
  { colKey: "statusLabel", title: "状态", width: 96 },
  { colKey: "issuesText", title: "预检结果", minWidth: 260 }
];

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
const precheckSummaryValues = computed(() => {
  const result = importPrecheckResult.value;
  if (!result) {
    return [];
  }

  return [
    { label: "预检行", value: String(result.totalRows), tone: "default" as const },
    { label: "可导入", value: String(result.readyRows), tone: "success" as const },
    { label: "需修正", value: String(result.blockedRows), tone: "danger" as const },
    { label: "有提醒", value: String(result.warningRows), tone: "warning" as const }
  ];
});
const importPrecheckRows = computed(() =>
  (importPrecheckResult.value?.rows ?? []).map((row) => {
    const hasErrors = row.issues.some((issue) => issue.level === "error");
    return {
      ...row,
      amount: row.amountCents === null ? "-" : centsToYuanText(row.amountCents),
      evidenceChecklist: row.evidenceChecklist || "未填写",
      issueSummary: row.issueSummary || "未填写",
      statusLabel: row.status === "ready" ? "可导入" : "需修正",
      statusTone: row.status === "ready" ? ("success" as const) : ("danger" as const),
      hasErrors,
      issuesText: row.issues.length
        ? row.issues.map((issue) => issue.message).join("；")
        : "通过"
    };
  })
);
const evidencePurposeOptions: Array<{ value: ContractTakeoverEvidencePurpose; label: string }> = [
  { value: "historical_contract_scan", label: "历史合同扫描件" },
  { value: "historical_settlement_ledger", label: "历史结算台账" },
  { value: "historical_payment_voucher", label: "历史付款凭证" },
  { value: "other", label: "其他接管资料" }
];
const selectedEvidenceFiles = computed(() =>
  (selectedRow.value?.takeover.evidenceFiles ?? []).map((file) => ({
    recordId: file.recordId,
    fileName: file.fileName,
    businessRef: selectedRow.value?.contractNo ?? "当前接管合同",
    purpose: file.purposeLabel,
    sizeBytes: file.sizeBytes,
    statusLabel: "已上传",
    uploadedByName: file.uploadedByName,
    uploadedAt: file.uploadedAt,
    confirmedByName: null,
    confirmedAt: null,
    canDownload: file.canDownload,
    disabledReason: file.disabledReason,
    auditHint: "下载需当前密码并记录审计"
  }))
);

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

async function submitImportPrecheck() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  prechecking.value = true;
  message.value = "";
  try {
    const rows = parseContractTakeoverImportPrecheckRows(importPrecheckText.value);
    importPrecheckResult.value = await precheckContractTakeoverImport(projectId, { rows });
    const result = importPrecheckResult.value;
    setMessage(
      `预检完成：${result.readyRows} 行可导入，${result.blockedRows} 行需修正`,
      result.blockedRows > 0 ? "default" : "success"
    );
  } catch (error) {
    importPrecheckResult.value = null;
    setMessage(error instanceof Error ? error.message : "导入预检失败", "danger");
  } finally {
    prechecking.value = false;
  }
}

function clearImportPrecheck() {
  importPrecheckText.value = "";
  importPrecheckResult.value = null;
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
    const payload = {
      code: requiredText(createForm.code, "合同编号"),
      name: requiredText(createForm.name, "合同名称"),
      counterparty: requiredText(createForm.counterparty, "相对方"),
      companyEntityName: createForm.companyEntityName.trim() || undefined,
      amountCents: yuanToCents(createForm.amountYuan, "合同金额"),
      signedAt: requiredText(createForm.signedAt, "签订日期"),
      takeoverCutoffDate: createForm.takeoverCutoffDate || undefined,
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
      evidenceSummary: requiredText(createForm.evidenceSummary, "证据说明"),
      responsibleUserId: createForm.responsibleUserId.trim() || undefined,
      reviewComment: createForm.reviewComment.trim() || undefined,
      acceptanceConclusion: createForm.acceptanceConclusion.trim() || undefined
    };
    const editingId = editingTakeoverId.value;
    const saved = editingId
      ? await updateContractTakeover(projectId, editingId, payload)
      : await createContractTakeover(projectId, payload);
    resetCreateForm();
    showCreateForm.value = false;
    editingTakeoverId.value = "";
    selectedTakeoverId.value = saved.id;
    setMessage(editingId ? "历史合同接管草稿已更新" : "历史合同接管草稿已保存", "success");
    await loadTakeovers();
    await selectTakeover(saved);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "保存历史合同接管失败", "danger");
  } finally {
    creating.value = false;
  }
}

function startCreate() {
  editingTakeoverId.value = "";
  resetCreateForm();
  showCreateForm.value = true;
}

function startEdit(takeover: ContractTakeoverReadModel) {
  if (!canEditTakeover(takeover)) {
    setMessage("只有草稿或待补充的接管记录可以编辑", "danger");
    return;
  }

  editingTakeoverId.value = takeover.id;
  Object.assign(createForm, formFromTakeover(takeover));
  selectedTakeoverId.value = takeover.id;
  showCreateForm.value = true;
}

function cancelEdit() {
  editingTakeoverId.value = "";
  resetCreateForm();
  showCreateForm.value = false;
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

function onEvidenceFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  evidenceFile.value = input.files?.[0] ?? null;
}

async function submitEvidenceFile() {
  const projectId = selectedProjectId.value;
  const takeover = selectedRow.value?.takeover;
  const file = evidenceFile.value;
  if (!projectId || !takeover || !file) {
    setMessage("请先选择接管记录和资料文件", "danger");
    return;
  }
  if (!canEditTakeover(takeover)) {
    setMessage("只有草稿或待补充的接管记录可以上传资料", "danger");
    return;
  }

  evidenceUploading.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    const updated = await attachContractTakeoverEvidenceFile(projectId, takeover.id, {
      fileId: uploaded.id,
      purpose: evidencePurpose.value
    });
    takeovers.value = takeovers.value.map((item) => (item.id === updated.id ? updated : item));
    selectedTakeoverId.value = updated.id;
    evidenceFile.value = null;
    if (evidenceInputRef.value) {
      evidenceInputRef.value.value = "";
    }
    setMessage("接管资料已上传并绑定到当前合同", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "上传接管资料失败", "danger");
  } finally {
    evidenceUploading.value = false;
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

function formFromTakeover(takeover: ContractTakeoverReadModel): CreateFormState {
  return {
    code: takeover.contractNo,
    name: takeover.contractName,
    counterparty: takeover.counterparty,
    companyEntityName: takeover.companyEntityName ?? "",
    amountYuan: centsToYuanInput(takeover.amountCents),
    signedAt: takeover.signedAt.slice(0, 10),
    takeoverCutoffDate: takeover.takeoverCutoffDate?.slice(0, 10) ?? "",
    takeoverLevel: takeover.takeoverLevel,
    lifecycleStatus: takeover.lifecycleStatus,
    paymentTermsOriginalText: takeover.paymentTermsOriginalText,
    historicalSettledYuan: centsToYuanInput(takeover.historicalSettledCents),
    historicalApprovalPendingPaymentYuan: centsToYuanInput(takeover.historicalApprovalPendingPaymentCents),
    historicalApprovedPendingPaymentYuan: centsToYuanInput(takeover.historicalApprovedPendingPaymentCents),
    historicalPaidYuan: centsToYuanInput(takeover.historicalPaidCents),
    historicalProxyPaidYuan: centsToYuanInput(takeover.historicalProxyPaidCents),
    historicalAdvancePaidYuan: centsToYuanInput(takeover.historicalAdvancePaidCents),
    historicalAdvanceDeductedYuan: centsToYuanInput(takeover.historicalAdvanceDeductedCents),
    historicalRetentionWithheldYuan: centsToYuanInput(takeover.historicalRetentionWithheldCents),
    historicalRetentionReleasedYuan: centsToYuanInput(takeover.historicalRetentionReleasedCents),
    otherConfirmedOccupancyYuan: centsToYuanInput(takeover.otherConfirmedOccupancyCents),
    balanceSourceSummary: takeover.balanceSourceSummary ?? "",
    evidenceSummary: takeover.evidenceSummary ?? "",
    responsibleUserId: takeover.responsibleUserId ?? "",
    reviewComment: takeover.reviewComment ?? "",
    acceptanceConclusion: takeover.acceptanceConclusion ?? ""
  };
}

function centsToYuanInput(value: number | string) {
  const cents = BigInt(value);
  const yuan = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");
  return `${yuan}.${fraction}`;
}

function createEmptyForm(): CreateFormState {
  return {
    code: "",
    name: "",
    counterparty: "",
    companyEntityName: "",
    amountYuan: "",
    signedAt: todayText(),
    takeoverCutoffDate: "",
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
    evidenceSummary: "",
    responsibleUserId: "",
    reviewComment: "",
    acceptanceConclusion: ""
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

.import-panel {
  min-width: 0;
}

.precheck-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(86px, 1fr));
  gap: 12px;
  margin: 14px 0;
  padding: 12px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.precheck-table {
  margin-top: 12px;
}

.issue-danger {
  color: #b51d2a;
}

.issue-muted {
  color: #4f5b6b;
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

.evidence-uploader {
  display: grid;
  grid-template-columns: minmax(140px, 0.8fr) minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.evidence-uploader label {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.evidence-uploader label span {
  color: #565f6d;
  font-size: 12px;
  font-weight: 600;
}

.evidence-uploader input[type="file"] {
  min-width: 0;
  font-size: 12px;
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
  .detail-list.money div,
  .evidence-uploader {
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
