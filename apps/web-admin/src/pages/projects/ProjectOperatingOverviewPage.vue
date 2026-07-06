<template>
  <section class="project-operating-page">
    <div class="page-head">
      <div>
        <h1>项目经营</h1>
        <p>只汇总当前系统已有合同、结算、付款、实际收款和财务出账数据</p>
      </div>
      <div class="project-tools">
        <label class="project-picker">
          <span>项目</span>
          <select
            v-model="selectedProjectId"
            :disabled="loadingProjects || projects.length === 0"
            @change="handleProjectChange"
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
        <form
          v-if="canManageProjects"
          class="project-create-form"
          @submit.prevent="submitProject"
        >
          <label>
            <span>项目编号</span>
            <input
              v-model.trim="projectForm.code"
              required
            >
          </label>
          <label>
            <span>项目名称</span>
            <input
              v-model.trim="projectForm.name"
              required
            >
          </label>
          <button
            type="submit"
            :disabled="projectSubmitting"
          >
            {{ projectSubmitting ? "新增中" : "新增项目" }}
          </button>
        </form>
        <form
          v-if="canManageProjects && selectedProjectId"
          class="project-name-form"
          @submit.prevent="submitProjectName"
        >
          <label>
            <span>当前项目名称</span>
            <input
              v-model.trim="selectedProjectName"
              required
            >
          </label>
          <button
            type="submit"
            :disabled="projectUpdating"
          >
            {{ projectUpdating ? "保存中" : "保存名称" }}
          </button>
        </form>
      </div>
    </div>

    <div
      v-if="projectMessage"
      class="receipt-message"
      :class="projectMessageTone"
    >
      {{ projectMessage }}
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

      <section class="panel receipt-panel">
        <div class="panel-head">
          <h2>实际收款登记</h2>
          <button
            type="button"
            :disabled="receiptSubmitting"
            @click="submitReceipt"
          >
            {{ receiptSubmitting ? "提交中" : "登记收款" }}
          </button>
        </div>
        <form
          class="receipt-form"
          @submit.prevent="submitReceipt"
        >
          <label>
            <span>收款日期</span>
            <input
              v-model="receiptForm.receivedAt"
              type="date"
              required
            >
          </label>
          <label>
            <span>收款金额(元)</span>
            <input
              v-model.trim="receiptForm.amountYuan"
              inputmode="decimal"
              placeholder="0.00"
              required
            >
          </label>
          <label>
            <span>付款单位</span>
            <input
              v-model.trim="receiptForm.payerName"
              required
            >
          </label>
          <label>
            <span>收款来源类型</span>
            <select v-model="receiptForm.sourceType">
              <option value="general_contractor_payment">总包付款</option>
              <option value="owner_direct_payment">业主直付</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label>
            <span>收款凭证</span>
            <input
              ref="receiptVoucherInput"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
              required
              @change="selectReceiptVoucher"
            >
          </label>
          <label>
            <span>当前登录密码</span>
            <input
              v-model="receiptForm.confirmationPassword"
              type="password"
              autocomplete="current-password"
              required
            >
          </label>
          <label class="receipt-description">
            <span>收款说明</span>
            <input v-model.trim="receiptForm.description">
          </label>
        </form>
        <div
          v-if="receiptMessage"
          class="receipt-message"
          :class="receiptMessageTone"
        >
          {{ receiptMessage }}
        </div>
      </section>

      <section class="panel receipt-panel">
        <div class="panel-head">
          <h2>总包代付登记</h2>
          <button
            type="button"
            :disabled="proxySubmitting"
            @click="submitProxyPayment"
          >
            {{ proxySubmitting ? "提交中" : "登记代付" }}
          </button>
        </div>
        <form
          class="receipt-form"
          @submit.prevent="submitProxyPayment"
        >
          <label>
            <span>代付日期</span>
            <input
              v-model="proxyForm.paidAt"
              type="date"
              required
            >
          </label>
          <label>
            <span>代付金额(元)</span>
            <input
              v-model.trim="proxyForm.amountYuan"
              inputmode="decimal"
              placeholder="0.00"
              required
            >
          </label>
          <label>
            <span>总包单位</span>
            <input
              v-model.trim="proxyForm.generalContractorName"
              required
            >
          </label>
          <label>
            <span>代付对象</span>
            <input
              v-model.trim="proxyForm.paidTargetName"
              required
            >
          </label>
          <label>
            <span>代付类型</span>
            <select v-model="proxyForm.paymentType">
              <option value="material">材料</option>
              <option value="equipment">机械</option>
              <option value="labor">劳务</option>
              <option value="professional_subcontract">专业分包</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label>
            <span>代付凭证</span>
            <input
              ref="proxyVoucherInput"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
              required
              @change="selectProxyVoucher"
            >
          </label>
          <label>
            <span>关联合同编号/ID</span>
            <input v-model.trim="proxyForm.contractId">
          </label>
          <label>
            <span>关联结算编号/ID</span>
            <input v-model.trim="proxyForm.settlementId">
          </label>
          <label>
            <span>当前登录密码</span>
            <input
              v-model="proxyForm.confirmationPassword"
              type="password"
              autocomplete="current-password"
              required
            >
          </label>
          <label class="receipt-description">
            <span>代付说明</span>
            <input v-model.trim="proxyForm.description">
          </label>
        </form>
        <div
          v-if="proxyMessage"
          class="receipt-message"
          :class="proxyMessageTone"
        >
          {{ proxyMessage }}
        </div>
      </section>

      <section class="panel receipt-panel">
        <div class="panel-head">
          <h2>支出明细</h2>
          <button
            type="button"
            :disabled="expenseSubmitting"
            @click="submitProjectExpense"
          >
            {{ expenseSubmitting ? "提交中" : "发起支出" }}
          </button>
        </div>
        <div class="expense-summary">
          <span
            v-for="item in projectExpenseSummaryItems"
            :key="item.label"
          >
            {{ item.label }}：<strong>{{ item.value }}</strong>
          </span>
        </div>
        <form
          class="receipt-form"
          @submit.prevent="submitProjectExpense"
        >
          <label>
            <span>支出单号</span>
            <input
              v-model.trim="expenseForm.code"
              required
            >
          </label>
          <label>
            <span>一级类型</span>
            <select
              v-model="expenseForm.expenseType"
              @change="syncExpenseSubtype"
            >
              <option
                v-for="option in expenseTypeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>明细类型</span>
            <select v-model="expenseForm.expenseSubtype">
              <option
                v-for="option in currentExpenseSubtypeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>付款主体</span>
            <input
              v-model.trim="expenseForm.paymentSubject"
              required
            >
          </label>
          <label>
            <span>申请金额(元)</span>
            <input
              v-model.trim="expenseForm.amountYuan"
              inputmode="decimal"
              placeholder="0.00"
              required
            >
          </label>
          <label>
            <span>付款方式</span>
            <select v-model="expenseForm.paymentMethod">
              <option
                v-for="option in expensePaymentMethodOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>对方名称</span>
            <input v-model.trim="expenseForm.counterpartyName">
          </label>
          <label>
            <span>对方户名</span>
            <input v-model.trim="expenseForm.counterpartyAccountName">
          </label>
          <label>
            <span>开户银行</span>
            <input v-model.trim="expenseForm.counterpartyBankName">
          </label>
          <label>
            <span>银行账号</span>
            <input v-model.trim="expenseForm.counterpartyBankAccount">
          </label>
          <label>
            <span>支出附件</span>
            <input
              ref="expenseAttachmentInput"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
              @change="selectExpenseAttachment"
            >
          </label>
          <label class="receipt-description">
            <span>付款事由</span>
            <input
              v-model.trim="expenseForm.reason"
              required
            >
          </label>
        </form>
        <div
          v-if="expenseMessage"
          class="receipt-message"
          :class="expenseMessageTone"
        >
          {{ expenseMessage }}
        </div>
        <div class="expense-table-wrap">
          <table>
            <thead>
              <tr>
                <th>支出单号</th>
                <th>类型</th>
                <th>付款主体</th>
                <th>申请金额</th>
                <th>已批金额</th>
                <th>已实付</th>
                <th>付款方式</th>
                <th>状态</th>
                <th>附件</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody v-if="projectExpenseRows.length">
              <tr
                v-for="row in projectExpenseRows"
                :key="row.id"
              >
                <td>{{ row.code }}</td>
                <td>{{ expenseTypeLabel(row.expenseType) }} · {{ expenseSubtypeLabel(row.expenseSubtype) }}</td>
                <td>{{ row.paymentSubject }}</td>
                <td>{{ formatCents(row.requestedAmountCents) }}</td>
                <td>{{ formatCents(row.approvedAmountCents) }}</td>
                <td>{{ formatCents(row.paidAmountCents) }}</td>
                <td>{{ expensePaymentMethodLabel(row.paymentMethod) }}</td>
                <td>{{ expenseStatusLabel(row.status) }}</td>
                <td>{{ row.hasAttachment ? "已上传" : "未上传" }}</td>
                <td>{{ formatDateTime(row.createdAt) }}</td>
                <td>
                  <button
                    type="button"
                    class="table-action"
                    @click="selectExpenseRow(row)"
                  >
                    处理
                  </button>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td
                  class="empty-cell"
                  colspan="11"
                >
                  暂无支出明细
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <section
          v-if="selectedExpenseRow"
          class="expense-action-panel"
        >
          <div class="expense-action-head">
            <div>
              <h3>处理支出单：{{ selectedExpenseRow.code }}</h3>
              <p>
                {{ expenseTypeLabel(selectedExpenseRow.expenseType) }} ·
                {{ expenseSubtypeLabel(selectedExpenseRow.expenseSubtype) }} ·
                {{ expenseStatusLabel(selectedExpenseRow.status) }}
              </p>
            </div>
            <button
              type="button"
              class="secondary-button"
              @click="clearSelectedExpenseRow"
            >
              取消选择
            </button>
          </div>
          <div class="receipt-form">
            <label>
              <span>审批意见</span>
              <input v-model.trim="expenseActionForm.approvalComment">
            </label>
            <label>
              <span>终审批准金额(元)</span>
              <input
                v-model.trim="expenseActionForm.approvedAmountYuan"
                inputmode="decimal"
                placeholder="不填则按申请金额"
              >
            </label>
            <label>
              <span>附件下载密码</span>
              <input
                v-model="expenseActionForm.downloadPassword"
                type="password"
                autocomplete="current-password"
              >
            </label>
            <label>
              <span>实付日期</span>
              <input
                v-model="expenseActionForm.executionPaidAt"
                type="date"
              >
            </label>
            <label>
              <span>实付金额(元)</span>
              <input
                v-model.trim="expenseActionForm.executionAmountYuan"
                inputmode="decimal"
                placeholder="0.00"
              >
            </label>
            <label>
              <span>实付凭证</span>
              <input
                ref="expenseExecutionVoucherInput"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                @change="selectExpenseExecutionVoucher"
              >
            </label>
            <label>
              <span>实付确认密码</span>
              <input
                v-model="expenseActionForm.executionPassword"
                type="password"
                autocomplete="current-password"
              >
            </label>
            <label>
              <span>入账日期</span>
              <input
                v-model="expenseActionForm.financeOccurredAt"
                type="date"
              >
            </label>
            <label>
              <span>入账金额(元)</span>
              <input
                v-model.trim="expenseActionForm.financeAmountYuan"
                inputmode="decimal"
                placeholder="0.00"
              >
            </label>
            <label>
              <span>入账确认密码</span>
              <input
                v-model="expenseActionForm.financePassword"
                type="password"
                autocomplete="current-password"
              >
            </label>
          </div>
          <div class="expense-action-buttons">
            <button
              v-if="canReviewExpense(selectedExpenseRow)"
              type="button"
              :disabled="expenseActionBusy !== ''"
              @click="submitExpenseReview('approve')"
            >
              审批通过
            </button>
            <button
              v-if="canReviewExpense(selectedExpenseRow)"
              type="button"
              class="danger-button"
              :disabled="expenseActionBusy !== ''"
              @click="submitExpenseReview('reject')"
            >
              审批驳回
            </button>
            <button
              v-if="canRecordExpenseExecution(selectedExpenseRow)"
              type="button"
              :disabled="expenseActionBusy !== ''"
              @click="submitExpenseExecution"
            >
              登记实付
            </button>
            <button
              v-if="canRecordExpenseFinance(selectedExpenseRow)"
              type="button"
              :disabled="expenseActionBusy !== ''"
              @click="submitExpenseFinance"
            >
              财务入账
            </button>
            <button
              v-if="selectedExpenseRow.hasAttachment"
              type="button"
              class="secondary-button"
              :disabled="expenseActionBusy !== ''"
              @click="downloadExpenseAttachment"
            >
              下载申请附件
            </button>
          </div>
          <div
            v-if="expenseActionMessage"
            class="receipt-message"
            :class="expenseActionMessageTone"
          >
            {{ expenseActionMessage }}
          </div>
        </section>
      </section>

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
  createProject,
  createProjectExpenseRequest,
  downloadProjectExpenseAttachment,
  fetchProjectExpenseRequests,
  fetchProjectOperatingOverview,
  fetchProjects,
  recordProjectExpenseExecution,
  recordProjectExpenseFinance,
  recordProjectProxyPayment,
  recordProjectReceipt,
  reviewProjectExpenseApproval,
  uploadPrivateFile,
  updateProject,
  type ProjectExpensePaymentMethod,
  type ProjectExpenseRequestListReadModel,
  type ProjectExpenseSubtype,
  type ProjectExpenseType,
  type ProjectOperatingOverviewReadModel,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import { useAuthStore } from "../../auth/auth.store";
import {
  expensePaymentMethodLabel,
  expensePaymentMethodOptions,
  expenseSubtypeLabel,
  expenseTypeLabel,
  expenseTypeOptions,
  subtypeOptionsFor
} from "./project-expense.config";

type ReceiptSourceType = "general_contractor_payment" | "owner_direct_payment" | "other";
type ProxyPaymentType = "material" | "equipment" | "labor" | "professional_subcontract" | "other";
type ProjectExpenseRow = ProjectExpenseRequestListReadModel["rows"][number];

interface ReceiptFormState {
  receivedAt: string;
  amountYuan: string;
  payerName: string;
  sourceType: ReceiptSourceType;
  description: string;
  voucherFile: File | null;
  confirmationPassword: string;
}

interface ProxyPaymentFormState {
  paidAt: string;
  amountYuan: string;
  generalContractorName: string;
  paidTargetName: string;
  paymentType: ProxyPaymentType;
  description: string;
  voucherFile: File | null;
  confirmationPassword: string;
  contractId: string;
  settlementId: string;
}

interface ProjectExpenseFormState {
  code: string;
  expenseType: ProjectExpenseType;
  expenseSubtype: ProjectExpenseSubtype;
  paymentSubject: string;
  reason: string;
  amountYuan: string;
  paymentMethod: ProjectExpensePaymentMethod;
  counterpartyName: string;
  counterpartyAccountName: string;
  counterpartyBankName: string;
  counterpartyBankAccount: string;
  attachmentFile: File | null;
}

interface ProjectExpenseActionFormState {
  approvalComment: string;
  approvedAmountYuan: string;
  executionAmountYuan: string;
  executionPaidAt: string;
  executionVoucherFile: File | null;
  executionPassword: string;
  financeAmountYuan: string;
  financeOccurredAt: string;
  financePassword: string;
  downloadPassword: string;
}

interface ProjectFormState {
  code: string;
  name: string;
}

const auth = useAuthStore();
const projects = ref<ProjectOptionReadModel[]>([]);
const overview = ref<ProjectOperatingOverviewReadModel | null>(null);
const projectExpenses = ref<ProjectExpenseRequestListReadModel | null>(null);
const selectedProjectId = ref("");
const loadingProjects = ref(false);
const loadingOverview = ref(false);
const message = ref("");
const projectSubmitting = ref(false);
const projectUpdating = ref(false);
const projectMessage = ref("");
const projectMessageTone = ref<"success" | "danger">("success");
const projectForm = ref<ProjectFormState>({ code: "", name: "" });
const selectedProjectName = ref("");
const receiptSubmitting = ref(false);
const receiptMessage = ref("");
const receiptMessageTone = ref<"success" | "danger">("success");
const receiptForm = ref<ReceiptFormState>(createReceiptForm());
const receiptVoucherInput = ref<HTMLInputElement | null>(null);
const proxySubmitting = ref(false);
const proxyMessage = ref("");
const proxyMessageTone = ref<"success" | "danger">("success");
const proxyForm = ref<ProxyPaymentFormState>(createProxyForm());
const proxyVoucherInput = ref<HTMLInputElement | null>(null);
const expenseSubmitting = ref(false);
const expenseMessage = ref("");
const expenseMessageTone = ref<"success" | "danger">("success");
const expenseAttachmentInput = ref<HTMLInputElement | null>(null);
const expenseForm = ref<ProjectExpenseFormState>(createProjectExpenseForm());
const selectedExpenseRow = ref<ProjectExpenseRow | null>(null);
const expenseActionForm = ref<ProjectExpenseActionFormState>(createProjectExpenseActionForm());
const expenseExecutionVoucherInput = ref<HTMLInputElement | null>(null);
const expenseActionBusy = ref("");
const expenseActionMessage = ref("");
const expenseActionMessageTone = ref<"success" | "danger">("success");

const summaryItems = computed(() => {
  const counts = overview.value?.counts ?? { contracts: 0, settlements: 0, payments: 0 };
  return [
    { label: "合同", value: String(counts.contracts) },
    { label: "结算", value: String(counts.settlements) },
    { label: "付款", value: String(counts.payments) },
    { label: "可用资金", value: formatCents(overview.value?.cash.availableFundsCents ?? null) }
  ];
});

const projectExpenseRows = computed<ProjectExpenseRow[]>(() => projectExpenses.value?.rows ?? []);

const projectExpenseSummaryItems = computed(() => {
  const summary = projectExpenses.value?.summary;
  return [
    { label: "支出单", value: String(summary?.total ?? 0) },
    { label: "审批中", value: String(summary?.approvalPending ?? 0) },
    { label: "已批待付", value: String(summary?.approvedPendingPayment ?? 0) },
    { label: "已实付", value: formatCents(summary?.totalPaidCents ?? 0) }
  ];
});

const currentExpenseSubtypeOptions = computed(() => subtypeOptionsFor(expenseForm.value.expenseType));

const canManageProjects = computed(
  () => auth.user?.roleKeys.some((role) => role === "chairman" || role === "general_manager") ?? false
);

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
    syncSelectedProjectName();
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

async function submitProject() {
  if (!canManageProjects.value) {
    return;
  }

  projectSubmitting.value = true;
  projectMessage.value = "";
  try {
    const created = await createProject({
      code: requiredText(projectForm.value.code, "项目编号"),
      name: requiredText(projectForm.value.name, "项目名称")
    });
    const nextProjects = await fetchProjects();
    projects.value = nextProjects.some((project) => project.id === created.id)
      ? nextProjects
      : [...nextProjects, created];
    selectedProjectId.value = projects.value.find((project) => project.id === created.id)?.id ?? created.id;
    projectForm.value = { code: "", name: "" };
    syncSelectedProjectName();
    projectMessageTone.value = "success";
    projectMessage.value = "项目已新增";
    await loadOverview();
  } catch (error) {
    projectMessageTone.value = "danger";
    projectMessage.value = error instanceof Error ? error.message : "新增项目失败";
  } finally {
    projectSubmitting.value = false;
  }
}

async function submitProjectName() {
  if (!canManageProjects.value || !selectedProjectId.value) {
    return;
  }

  projectUpdating.value = true;
  projectMessage.value = "";
  try {
    const updated = await updateProject(selectedProjectId.value, {
      name: requiredText(selectedProjectName.value, "项目名称")
    });
    projects.value = projects.value.map((project) => (project.id === updated.id ? updated : project));
    selectedProjectName.value = updated.name;
    projectMessageTone.value = "success";
    projectMessage.value = "项目名称已保存";
    await loadOverview();
  } catch (error) {
    projectMessageTone.value = "danger";
    projectMessage.value = error instanceof Error ? error.message : "保存项目名称失败";
  } finally {
    projectUpdating.value = false;
  }
}

function handleProjectChange() {
  syncSelectedProjectName();
  void loadOverview();
}

function syncSelectedProjectName() {
  selectedProjectName.value = projects.value.find((project) => project.id === selectedProjectId.value)?.name ?? "";
}

async function loadOverview() {
  const projectId = selectedProjectId.value;
  const selectedExpenseId = selectedExpenseRow.value?.id ?? "";
  overview.value = null;
  projectExpenses.value = null;
  receiptMessage.value = "";
  proxyMessage.value = "";
  expenseMessage.value = "";
  expenseActionMessage.value = "";
  if (!projectId) {
    overview.value = null;
    selectedExpenseRow.value = null;
    return;
  }

  loadingOverview.value = true;
  message.value = "";
  try {
    const [nextOverview, nextExpenses] = await Promise.all([
      fetchProjectOperatingOverview(projectId),
      fetchProjectExpenseRequests(projectId)
    ]);
    if (selectedProjectId.value === projectId) {
      overview.value = nextOverview;
      projectExpenses.value = nextExpenses;
      selectedExpenseRow.value = selectedExpenseId
        ? nextExpenses.rows.find((row) => row.id === selectedExpenseId) ?? null
        : null;
    }
  } catch (error) {
    if (selectedProjectId.value === projectId) {
      overview.value = null;
      selectedExpenseRow.value = null;
      message.value = error instanceof Error ? error.message : "加载项目经营数据失败";
    }
  } finally {
    if (selectedProjectId.value === projectId) {
      loadingOverview.value = false;
    }
  }
}

async function submitProjectExpense() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setExpenseError("请先选择项目");
    return;
  }

  expenseSubmitting.value = true;
  expenseMessage.value = "";
  try {
    const form = expenseForm.value;
    const code = requiredText(form.code, "支出单号");
    const paymentSubject = requiredText(form.paymentSubject, "付款主体");
    const reason = requiredText(form.reason, "付款事由");
    const requestedAmountCents = parseYuanToCents(form.amountYuan, "申请金额");
    if (requestedAmountCents > 2_147_483_647) {
      throw new Error("申请金额超过系统支持范围");
    }
    const attachment = form.attachmentFile
      ? await uploadPrivateFile(form.attachmentFile, form.attachmentFile.name)
      : null;
    await createProjectExpenseRequest(projectId, {
      code,
      expenseType: form.expenseType,
      expenseSubtype: form.expenseSubtype,
      paymentSubject,
      reason,
      requestedAmountCents,
      paymentMethod: form.paymentMethod,
      counterpartyName: form.counterpartyName.trim() || undefined,
      counterpartyAccountName: form.counterpartyAccountName.trim() || undefined,
      counterpartyBankName: form.counterpartyBankName.trim() || undefined,
      counterpartyBankAccount: form.counterpartyBankAccount.trim() || undefined,
      attachmentFileId: attachment?.id
    });
    expenseForm.value = createProjectExpenseForm(form.expenseType);
    if (expenseAttachmentInput.value) {
      expenseAttachmentInput.value.value = "";
    }
    await loadOverview();
    expenseMessageTone.value = "success";
    expenseMessage.value = "项目支出已提交审批，资金占用已刷新。";
  } catch (error) {
    setExpenseError(error instanceof Error ? error.message : "提交项目支出失败");
  } finally {
    expenseSubmitting.value = false;
  }
}

async function submitReceipt() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setReceiptError("请先选择项目");
    return;
  }

  receiptSubmitting.value = true;
  receiptMessage.value = "";
  try {
    const form = receiptForm.value;
    if (!form.voucherFile) {
      throw new Error("请上传收款凭证");
    }
    const receivedAt = requiredText(form.receivedAt, "收款日期");
    const amountCents = parseYuanToCents(form.amountYuan, "收款金额");
    const payerName = requiredText(form.payerName, "付款单位");
    const confirmationPassword = requiredText(form.confirmationPassword, "当前登录密码");
    const voucher = await uploadPrivateFile(form.voucherFile, form.voucherFile.name);
    await recordProjectReceipt(projectId, {
      receivedAt,
      amountCents,
      payerName,
      sourceType: form.sourceType,
      description: form.description.trim() || undefined,
      voucherFileId: voucher.id,
      confirmationPassword
    });
    receiptForm.value = createReceiptForm(form.sourceType);
    if (receiptVoucherInput.value) {
      receiptVoucherInput.value.value = "";
    }
    await loadOverview();
    receiptMessageTone.value = "success";
    receiptMessage.value = "实际收款已登记，项目经营数据已刷新。";
  } catch (error) {
    setReceiptError(error instanceof Error ? error.message : "登记收款失败");
  } finally {
    receiptSubmitting.value = false;
  }
}

async function submitProxyPayment() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setProxyError("请先选择项目");
    return;
  }

  proxySubmitting.value = true;
  proxyMessage.value = "";
  try {
    const form = proxyForm.value;
    if (!form.voucherFile) {
      throw new Error("请上传代付凭证");
    }
    const paidAt = requiredText(form.paidAt, "代付日期");
    const amountCents = parseYuanToCents(form.amountYuan, "代付金额");
    const generalContractorName = requiredText(form.generalContractorName, "总包单位");
    const paidTargetName = requiredText(form.paidTargetName, "代付对象");
    const confirmationPassword = requiredText(form.confirmationPassword, "当前登录密码");
    const voucher = await uploadPrivateFile(form.voucherFile, form.voucherFile.name);
    await recordProjectProxyPayment(projectId, {
      paidAt,
      amountCents,
      generalContractorName,
      paidTargetName,
      paymentType: form.paymentType,
      description: form.description.trim() || undefined,
      voucherFileId: voucher.id,
      confirmationPassword,
      contractId: form.contractId.trim() || undefined,
      settlementId: form.settlementId.trim() || undefined
    });
    proxyForm.value = createProxyForm(form.paymentType);
    if (proxyVoucherInput.value) {
      proxyVoucherInput.value.value = "";
    }
    await loadOverview();
    proxyMessageTone.value = "success";
    proxyMessage.value = "总包代付已登记，项目经营数据已刷新。";
  } catch (error) {
    setProxyError(error instanceof Error ? error.message : "登记总包代付失败");
  } finally {
    proxySubmitting.value = false;
  }
}

function createReceiptForm(sourceType: ReceiptSourceType = "general_contractor_payment"): ReceiptFormState {
  return {
    receivedAt: todayText(),
    amountYuan: "",
    payerName: "",
    sourceType,
    description: "",
    voucherFile: null,
    confirmationPassword: ""
  };
}

function createProxyForm(paymentType: ProxyPaymentType = "material"): ProxyPaymentFormState {
  return {
    paidAt: todayText(),
    amountYuan: "",
    generalContractorName: "",
    paidTargetName: "",
    paymentType,
    description: "",
    voucherFile: null,
    confirmationPassword: "",
    contractId: "",
    settlementId: ""
  };
}

function createProjectExpenseForm(
  expenseType: ProjectExpenseType = "sporadic_payment"
): ProjectExpenseFormState {
  return {
    code: "",
    expenseType,
    expenseSubtype: subtypeOptionsFor(expenseType)[0].value,
    paymentSubject: "",
    reason: "",
    amountYuan: "",
    paymentMethod: "bank_transfer",
    counterpartyName: "",
    counterpartyAccountName: "",
    counterpartyBankName: "",
    counterpartyBankAccount: "",
    attachmentFile: null
  };
}

function createProjectExpenseActionForm(row?: ProjectExpenseRow): ProjectExpenseActionFormState {
  const remainingCents = row
    ? Math.max((row.approvedAmountCents ?? row.requestedAmountCents) - row.paidAmountCents, 0)
    : 0;
  return {
    approvalComment: "",
    approvedAmountYuan: "",
    executionAmountYuan: remainingCents > 0 ? centsToYuanInput(remainingCents) : "",
    executionPaidAt: todayText(),
    executionVoucherFile: null,
    executionPassword: "",
    financeAmountYuan: "",
    financeOccurredAt: todayText(),
    financePassword: "",
    downloadPassword: ""
  };
}

function selectReceiptVoucher(event: Event) {
  const input = event.target as HTMLInputElement;
  receiptForm.value.voucherFile = input.files?.[0] ?? null;
}

function selectProxyVoucher(event: Event) {
  const input = event.target as HTMLInputElement;
  proxyForm.value.voucherFile = input.files?.[0] ?? null;
}

function selectExpenseAttachment(event: Event) {
  const input = event.target as HTMLInputElement;
  expenseForm.value.attachmentFile = input.files?.[0] ?? null;
}

function selectExpenseExecutionVoucher(event: Event) {
  const input = event.target as HTMLInputElement;
  expenseActionForm.value.executionVoucherFile = input.files?.[0] ?? null;
}

function selectExpenseRow(row: ProjectExpenseRow) {
  selectedExpenseRow.value = row;
  expenseActionForm.value = createProjectExpenseActionForm(row);
  expenseActionMessage.value = "";
  if (expenseExecutionVoucherInput.value) {
    expenseExecutionVoucherInput.value.value = "";
  }
}

function clearSelectedExpenseRow() {
  selectedExpenseRow.value = null;
  expenseActionForm.value = createProjectExpenseActionForm();
  expenseActionMessage.value = "";
}

function syncExpenseSubtype() {
  const options = subtypeOptionsFor(expenseForm.value.expenseType);
  if (!options.some((option) => option.value === expenseForm.value.expenseSubtype)) {
    expenseForm.value.expenseSubtype = options[0].value;
  }
}

function expenseStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approval_pending: "审批中",
    withdrawn: "已撤回",
    rejected: "已驳回",
    approved_pending_payment: "已批待付款",
    partially_paid: "部分付款",
    paid: "已付款",
    voided: "已作废",
    payment_blocked: "付款阻断"
  };
  return labels[status] ?? status;
}

function canReviewExpense(row: ProjectExpenseRow) {
  return row.status === "approval_pending";
}

function canRecordExpenseExecution(row: ProjectExpenseRow) {
  return ["approved_pending_payment", "partially_paid"].includes(row.status);
}

function canRecordExpenseFinance(row: ProjectExpenseRow) {
  return ["partially_paid", "paid", "payment_blocked"].includes(row.status);
}

function todayText(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`请填写${label}`);
  }
  return trimmed;
}

function parseYuanToCents(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`${label}必须是大于 0 的数字，最多保留两位小数`);
  }

  const [yuan, cents = ""] = trimmed.split(".");
  const amountCents = Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`${label}必须大于 0`);
  }
  return amountCents;
}

function setReceiptError(messageText: string) {
  receiptMessageTone.value = "danger";
  receiptMessage.value = messageText;
}

function setProxyError(messageText: string) {
  proxyMessageTone.value = "danger";
  proxyMessage.value = messageText;
}

function setExpenseError(messageText: string) {
  expenseMessageTone.value = "danger";
  expenseMessage.value = messageText;
}

async function runExpenseAction(actionKey: string, action: (row: ProjectExpenseRow) => Promise<void>) {
  const row = selectedExpenseRow.value;
  if (!row) {
    setExpenseActionError("请先选择支出单");
    return;
  }
  expenseActionBusy.value = actionKey;
  expenseActionMessage.value = "";
  try {
    await action(row);
    await loadOverview();
    if (selectedExpenseRow.value) {
      expenseActionForm.value = createProjectExpenseActionForm(selectedExpenseRow.value);
    }
    if (expenseExecutionVoucherInput.value) {
      expenseExecutionVoucherInput.value.value = "";
    }
    expenseActionMessageTone.value = "success";
    expenseActionMessage.value = "支出单处理完成，项目经营数据已刷新。";
  } catch (error) {
    setExpenseActionError(error instanceof Error ? error.message : "支出单处理失败");
  } finally {
    expenseActionBusy.value = "";
  }
}

async function submitExpenseReview(decision: "approve" | "reject") {
  await runExpenseAction("review", async (row) => {
    const approvedAmount = expenseActionForm.value.approvedAmountYuan.trim();
    await reviewProjectExpenseApproval(selectedProjectId.value, row.id, {
      decision,
      approvedAmountCents:
        decision === "approve" && approvedAmount
          ? parseYuanToCents(approvedAmount, "终审批准金额")
          : undefined,
      comment: expenseActionForm.value.approvalComment.trim() || undefined
    });
  });
}

async function submitExpenseExecution() {
  await runExpenseAction("execution", async (row) => {
    const form = expenseActionForm.value;
    if (!form.executionVoucherFile) {
      throw new Error("请上传实付凭证");
    }
    const voucher = await uploadPrivateFile(form.executionVoucherFile, form.executionVoucherFile.name);
    await recordProjectExpenseExecution(selectedProjectId.value, row.id, {
      amountCents: parseYuanToCents(form.executionAmountYuan, "实付金额"),
      paidAt: requiredText(form.executionPaidAt, "实付日期"),
      voucherFileId: voucher.id,
      confirmationPassword: requiredText(form.executionPassword, "实付确认密码")
    });
  });
}

async function submitExpenseFinance() {
  await runExpenseAction("finance", async (row) => {
    const form = expenseActionForm.value;
    await recordProjectExpenseFinance(selectedProjectId.value, row.id, {
      amountCents: parseYuanToCents(form.financeAmountYuan, "入账金额"),
      occurredAt: requiredText(form.financeOccurredAt, "入账日期"),
      confirmationPassword: requiredText(form.financePassword, "入账确认密码")
    });
  });
}

async function downloadExpenseAttachment() {
  await runExpenseAction("download", async (row) => {
    if (!row.hasAttachment) {
      throw new Error("该支出单未上传申请附件");
    }
    const ticket = await downloadProjectExpenseAttachment(selectedProjectId.value, row.id, {
      confirmationPassword: requiredText(expenseActionForm.value.downloadPassword, "附件下载密码")
    });
    triggerFileDownload(apiDownloadUrl(ticket.downloadUrl), ticket.fileName);
  });
}

function setExpenseActionError(messageText: string) {
  expenseActionMessageTone.value = "danger";
  expenseActionMessage.value = messageText;
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

function triggerFileDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
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

function centsToYuanInput(value: number): string {
  return (value / 100).toFixed(2);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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
.project-create-form span,
.project-name-form span,
.message,
.gap-panel li {
  color: #5f6673;
}

.project-tools {
  display: grid;
  gap: 10px;
  min-width: min(720px, 100%);
}

.project-picker {
  display: grid;
  gap: 6px;
}

.project-create-form {
  display: grid;
  grid-template-columns: 120px minmax(220px, 1fr) auto;
  align-items: end;
  gap: 8px;
}

.project-name-form {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: end;
  gap: 8px;
}

.project-create-form label,
.project-name-form label {
  display: grid;
  gap: 6px;
}

select {
  height: 32px;
  border: 1px solid #cfd7e3;
  border-radius: 4px;
  padding: 0 10px;
  background: #fff;
}

input {
  height: 32px;
  min-width: 0;
  border: 1px solid #cfd7e3;
  border-radius: 4px;
  padding: 0 10px;
  background: #fff;
}

button {
  height: 32px;
  border: 0;
  border-radius: 4px;
  padding: 0 14px;
  color: #fff;
  background: #165dff;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  background: #a8b1c2;
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

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.receipt-panel {
  display: grid;
  gap: 12px;
}

.receipt-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.receipt-form label {
  display: grid;
  gap: 6px;
}

.receipt-form span {
  color: #5f6673;
}

.receipt-description {
  grid-column: span 3;
}

.receipt-message {
  padding: 10px 12px;
  border-radius: 6px;
}

.receipt-message.success {
  color: #0f7a3b;
  background: #edf8f0;
}

.receipt-message.danger {
  color: #b42318;
  background: #fff1f0;
}

.expense-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  color: #5f6673;
}

.expense-summary strong {
  color: #1f2733;
}

.expense-table-wrap {
  overflow-x: auto;
  border: 1px solid #edf0f5;
  border-radius: 6px;
}

table {
  width: 100%;
  min-width: 920px;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #edf0f5;
}

th {
  color: #5f6673;
  font-weight: 600;
  background: #f7f9fc;
}

td {
  color: #1f2733;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.table-action {
  height: 28px;
  padding: 0 10px;
}

.empty-cell {
  color: #5f6673;
  text-align: center;
}

.secondary-button {
  color: #1f2733;
  background: #eef2f8;
}

.danger-button {
  background: #d54941;
}

.expense-action-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  background: #f8fbff;
}

.expense-action-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.expense-action-head h3 {
  margin: 0;
  font-size: 14px;
}

.expense-action-head p {
  margin-top: 4px;
}

.expense-action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  .expense-action-head,
  dl div {
    display: grid;
  }

  .project-picker {
    min-width: 0;
  }

  .project-tools,
  .project-create-form,
  .project-name-form {
    min-width: 0;
  }

  .project-create-form,
  .project-name-form {
    grid-template-columns: 1fr;
  }

  .summary-strip,
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .receipt-form {
    grid-template-columns: 1fr;
  }

  .receipt-description {
    grid-column: auto;
  }
}
</style>
