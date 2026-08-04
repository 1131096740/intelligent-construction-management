<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch
} from "vue";
import type { PrimaryTableCol, UploadFile } from "tdesign-vue-next";
import {
  confirmProjectAffiliateCompanyContract,
  createProjectAffiliateCompanyContractRecordAttemptState,
  fetchProjectAffiliateCompanyContracts,
  recordProjectAffiliateCompanyContractWithUpload,
  type ProjectAffiliateCompanyContractRecordAttemptState,
  type ProjectAffiliateCompanyContractReadModel,
  type ProjectAffiliateCompanyContractsReadModel
} from "../../../api/core-flow-read.api";
import {
  fetchActiveCompanyEntities,
  type CompanyEntityModel
} from "../../../api/company-entity.api";
import SensitiveActionDialog from "../../../components/SensitiveActionDialog.vue";

const props = defineProps<{ projectId: string }>();

type ConfirmContext = {
  projectId: string;
  contractId: string;
  projectGeneration: number;
  confirmationActionId: string;
};

type ConfirmOperationContext = ConfirmContext & {
  operationId: number;
};

type RecordContext = {
  projectId: string;
  projectGeneration: number;
  idempotencyKey: string;
};

type RecordOperationContext = RecordContext & {
  operationId: number;
};

const EMPTY_CONFIRM_CONTEXT: ConfirmContext = {
  projectId: "",
  contractId: "",
  projectGeneration: -1,
  confirmationActionId: ""
};

const EMPTY_RECORD_CONTEXT: RecordContext = {
  projectId: "",
  projectGeneration: -1,
  idempotencyKey: ""
};

const data = ref<ProjectAffiliateCompanyContractsReadModel | null>(null);
const companies = ref<CompanyEntityModel[]>([]);
const loading = ref(false);
const loadError = ref("");
const notice = ref("");
const recordVisible = ref(false);
const recordBusy = ref(false);
const recordError = ref("");
const signedFiles = ref<UploadFile[]>([]);
const form = ref(createForm());
let affiliateCompanyContractCapability: ProjectAffiliateCompanyContractsReadModel | null =
  null;
const affiliateCompanyContractRootActions = shallowRef<
  ProjectAffiliateCompanyContractsReadModel["availableActions"] | null
>(null);
const selectedAffiliateCompanyContractActions = shallowRef<
  Array<"confirm"> | null
>(null);
const recordContext = ref<RecordContext>({ ...EMPTY_RECORD_CONTEXT });
const recordArmed = ref(false);
const recordAttempted = ref(false);
const confirmTarget = ref<ProjectAffiliateCompanyContractReadModel | null>(null);
const confirmContext = ref<ConfirmContext>({ ...EMPTY_CONFIRM_CONTEXT });
const confirmArmed = ref(false);
const confirmVisible = ref(false);
const confirmBusy = ref(false);
const confirmError = ref("");
let projectGeneration = 0;
let loadRequestId = 0;
let confirmOperationSequence = 0;
let activeConfirmOperationId = 0;
let recordOperationSequence = 0;
let activeRecordOperationId = 0;
let recordAttemptState: ProjectAffiliateCompanyContractRecordAttemptState =
  createProjectAffiliateCompanyContractRecordAttemptState();
let componentAlive = true;

const columns: PrimaryTableCol[] = [
  { colKey: "contractReference", title: "线下合同编号", width: 170 },
  { colKey: "contractName", title: "合同名称", width: 200 },
  { colKey: "affiliateNameSnapshot", title: "挂靠企业", width: 180 },
  { colKey: "companyEntityNameSnapshot", title: "我方主体", width: 180 },
  { colKey: "signedAt", title: "签订日期", width: 120 },
  { colKey: "rightsObligationsSummary", title: "权利义务摘要", width: 300 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "operation", title: "操作", fixed: "right", width: 100 }
];

onMounted(load);
onBeforeUnmount(() => {
  componentAlive = false;
  projectGeneration += 1;
  loadRequestId += 1;
  activeConfirmOperationId = 0;
  activeRecordOperationId = 0;
});
watch(
  () => props.projectId,
  () => {
    projectGeneration += 1;
    loadRequestId += 1;
    activeConfirmOperationId = 0;
    activeRecordOperationId = 0;
    confirmBusy.value = false;
    recordBusy.value = false;
    loading.value = false;
    data.value = null;
    affiliateCompanyContractCapability = null;
    affiliateCompanyContractRootActions.value = null;
    selectedAffiliateCompanyContractActions.value = null;
    companies.value = [];
    notice.value = "";
    loadError.value = "";
    clearRecordSelection();
    clearConfirmSelection();
    void load();
  }
);

async function load() {
  const expectedProjectId = props.projectId;
  if (!expectedProjectId) {
    loading.value = false;
    return;
  }
  const expectedProjectGeneration = projectGeneration;
  const requestId = ++loadRequestId;
  loading.value = true;
  loadError.value = "";
  data.value = null;
  affiliateCompanyContractCapability = null;
  affiliateCompanyContractRootActions.value = null;
  selectedAffiliateCompanyContractActions.value = null;
  companies.value = [];
  clearRecordSelection();
  clearConfirmSelection();
  let contractsPublished = false;
  try {
    const contracts =
      await fetchProjectAffiliateCompanyContracts(expectedProjectId);
    if (
      !loadContextIsCurrent(
        expectedProjectId,
        expectedProjectGeneration,
        requestId
      )
    ) {
      return;
    }
    affiliateCompanyContractCapability = contracts;
    affiliateCompanyContractRootActions.value =
      contracts.availableActions;
    data.value = structuredClone(contracts);
    contractsPublished = true;
    if (
      !contracts.availableActions.includes(
        "record_affiliate_company_contract"
      )
    ) {
      return;
    }
    const nextCompanies = await fetchActiveCompanyEntities();
    if (
      !loadContextIsCurrent(
        expectedProjectId,
        expectedProjectGeneration,
        requestId
      )
    ) {
      return;
    }
    companies.value = nextCompanies;
  } catch (error) {
    if (
      loadContextIsCurrent(
        expectedProjectId,
        expectedProjectGeneration,
        requestId
      )
    ) {
      loadError.value = errorMessage(
        error,
        contractsPublished
          ? "我方签约主体读取失败，合同确认仍可继续"
          : "挂靠企业与我方线下合同读取失败"
      );
    }
  } finally {
    if (
      loadContextIsCurrent(
        expectedProjectId,
        expectedProjectGeneration,
        requestId
      )
    ) {
      loading.value = false;
    }
  }
}

function loadContextIsCurrent(
  expectedProjectId: string,
  expectedProjectGeneration: number,
  requestId: number
) {
  return (
    componentAlive &&
    props.projectId === expectedProjectId &&
    projectGeneration === expectedProjectGeneration &&
    loadRequestId === requestId
  );
}

function openRecord() {
  if (
    recordBusy.value ||
    !recordActionEnabled("record_affiliate_company_contract")
  ) {
    clearRecordSelection();
    return;
  }
  form.value = createForm();
  signedFiles.value = [];
  recordError.value = "";
  recordContext.value = {
    projectId: props.projectId,
    projectGeneration,
    idempotencyKey: crypto.randomUUID()
  };
  recordAttemptState =
    createProjectAffiliateCompanyContractRecordAttemptState();
  recordAttempted.value = false;
  recordArmed.value = true;
  recordVisible.value = true;
}

function submitRecord() {
  const context = captureRecordOperation();
  const request = recordProjectAffiliateCompanyContractWithUpload(
    context.projectId,
    {
      form: form.value,
      files: signedFiles.value,
      idempotencyKey: context.idempotencyKey,
      context,
      isCurrent: recordContextIsCurrent
    },
    recordAttemptState
  );
  recordOperationSequence = context.operationId;
  activeRecordOperationId = context.operationId;
  recordAttempted.value = recordAttemptState.submission !== null;
  recordBusy.value = true;
  recordError.value = "";
  return request
    .then(() => completeRecord(context))
    .catch((error) => failRecord(error, context))
    .finally(() => finishRecord(context));
}

function recordActionEnabled(
  key: "record_affiliate_company_contract"
) {
  return (
    affiliateCompanyContractRootActions.value !== null &&
    affiliateCompanyContractRootActions.value.includes(key)
  );
}

function captureRecordOperation(): RecordOperationContext {
  return {
    ...recordContext.value,
    operationId: recordOperationSequence + 1
  };
}

function recordContextIsCurrent(context: RecordContext) {
  const selected = recordContext.value;
  return Boolean(
    componentAlive &&
      recordArmed.value &&
      recordVisible.value &&
      selected.projectId === context.projectId &&
      selected.projectGeneration === context.projectGeneration &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration &&
      recordActionEnabled("record_affiliate_company_contract")
  );
}

function recordOperationIsCurrent(context: RecordOperationContext) {
  return (
    componentAlive &&
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    activeRecordOperationId === context.operationId
  );
}

function recordResultCanWrite(context: RecordOperationContext) {
  return (
    recordOperationIsCurrent(context) &&
    recordContextIsCurrent(context)
  );
}

function completeRecord(context: RecordOperationContext) {
  if (!recordResultCanWrite(context)) return;
  clearRecordSelection();
  notice.value =
    "已签线下合同已登记并冻结双方主体与文件摘要；未创建我方审批、用章或业主回款。";
  return load();
}

function failRecord(error: unknown, context: RecordOperationContext) {
  if (!recordResultCanWrite(context)) return;
  recordError.value = errorMessage(error, "线下合同登记失败");
}

function finishRecord(context: RecordOperationContext) {
  if (activeRecordOperationId !== context.operationId) return;
  recordBusy.value = false;
}

function cancelRecord() {
  if (recordBusy.value) return;
  activeRecordOperationId = 0;
  clearRecordSelection();
}

function handleRecordVisibleChange(visible: boolean) {
  if (visible || recordBusy.value) return;
  cancelRecord();
}

function clearRecordSelection() {
  recordVisible.value = false;
  recordContext.value = { ...EMPTY_RECORD_CONTEXT };
  recordArmed.value = false;
  recordAttemptState =
    createProjectAffiliateCompanyContractRecordAttemptState();
  recordAttempted.value = false;
  signedFiles.value = [];
  form.value = createForm();
  recordError.value = "";
}

function confirmActionEnabled(
  contractId: string,
  key: "confirm"
) {
  return (
    affiliateCompanyContractCapability !== null &&
    affiliateCompanyContractCapability.contracts.some(
      (contract) =>
        contract.id === contractId &&
        contract.projectId === props.projectId &&
        contract.status === "pending_confirm" &&
        contract.availableActions.includes(key)
    )
  );
}

function findConfirmCapabilityIndex(contractId: string) {
  return (
    affiliateCompanyContractCapability?.contracts.findIndex(
      (contract) =>
        contract.id === contractId &&
        contract.projectId === props.projectId &&
        contract.status === "pending_confirm" &&
        contract.availableActions.includes("confirm")
    ) ?? -1
  );
}

function openConfirm(contract: ProjectAffiliateCompanyContractReadModel) {
  if (confirmBusy.value) return;
  const capabilityIndex = findConfirmCapabilityIndex(contract.id);
  if (
    capabilityIndex < 0 ||
    affiliateCompanyContractCapability === null
  ) {
    clearConfirmSelection();
    return;
  }
  const capability =
    affiliateCompanyContractCapability.contracts[capabilityIndex]!;
  selectedAffiliateCompanyContractActions.value =
    affiliateCompanyContractCapability.contracts[
      capabilityIndex
    ]!.availableActions;
  activeConfirmOperationId = 0;
  confirmContext.value = {
    projectId: props.projectId,
    contractId: capability.id,
    projectGeneration,
    confirmationActionId: crypto.randomUUID()
  };
  confirmArmed.value = true;
  confirmTarget.value = structuredClone(capability);
  confirmError.value = "";
  confirmVisible.value = true;
}

function confirmContextIsCurrent(context: ConfirmContext) {
  const selected = confirmContext.value;
  return Boolean(
    confirmArmed.value &&
      selected.projectId === context.projectId &&
      selected.contractId === context.contractId &&
      selected.projectGeneration === context.projectGeneration &&
      selected.confirmationActionId === context.confirmationActionId &&
      props.projectId === context.projectId &&
      projectGeneration === context.projectGeneration &&
      confirmVisible.value &&
      confirmActionEnabled(context.contractId, "confirm") &&
      selectedAffiliateCompanyContractActions.value !== null &&
      selectedAffiliateCompanyContractActions.value.includes("confirm")
  );
}

function requireCurrentConfirmContractId(context: ConfirmContext) {
  const selected = confirmContext.value;
  if (
    confirmBusy.value ||
    !confirmArmed.value ||
    selected.projectId !== context.projectId ||
    selected.contractId !== context.contractId ||
    selected.projectGeneration !== context.projectGeneration ||
    selected.confirmationActionId !== context.confirmationActionId ||
    props.projectId !== context.projectId ||
    projectGeneration !== context.projectGeneration ||
    !confirmVisible.value ||
    !confirmActionEnabled(context.contractId, "confirm") ||
    selectedAffiliateCompanyContractActions.value === null ||
    !selectedAffiliateCompanyContractActions.value.includes("confirm")
  ) {
    throw new Error("线下合同确认上下文已失效，请重新读取当前合同");
  }
  return context.contractId;
}

function captureConfirmOperation(): ConfirmOperationContext {
  const selected = confirmContext.value;
  return {
    ...selected,
    operationId: confirmOperationSequence + 1
  };
}

function confirmOperationIsCurrent(context: ConfirmOperationContext) {
  return (
    props.projectId === context.projectId &&
    projectGeneration === context.projectGeneration &&
    activeConfirmOperationId === context.operationId
  );
}

function confirmResultCanWrite(context: ConfirmOperationContext) {
  return (
    confirmOperationIsCurrent(context) &&
    confirmContextIsCurrent(context)
  );
}

function completeConfirm(context: ConfirmOperationContext) {
  if (!confirmResultCanWrite(context)) return;
  clearConfirmSelection();
  notice.value =
    "合同主管已确认并冻结当前手写签名版本；该确认不是我方合同审批。";
  return load();
}

function failConfirm(error: unknown, context: ConfirmOperationContext) {
  if (!confirmResultCanWrite(context)) return;
  confirmError.value = errorMessage(error, "线下合同确认失败");
}

function finishConfirm(context: ConfirmOperationContext) {
  if (!confirmOperationIsCurrent(context)) return;
  confirmBusy.value = false;
}

function submitConfirm(values: { password: string }) {
  const context = captureConfirmOperation();
  const request = confirmProjectAffiliateCompanyContract(
    context.projectId,
    requireCurrentConfirmContractId(context),
    {
      confirmationPassword: requireConfirmationPassword(values.password),
      confirmationActionId: context.confirmationActionId
    }
  );
  confirmOperationSequence = context.operationId;
  activeConfirmOperationId = context.operationId;
  confirmBusy.value = true;
  confirmError.value = "";
  return request
    .then(() => completeConfirm(context))
    .catch((error) => failConfirm(error, context))
    .finally(() => finishConfirm(context));
}

function cancelConfirm() {
  if (confirmBusy.value) return;
  activeConfirmOperationId = 0;
  clearConfirmSelection();
}

function clearConfirmSelection() {
  confirmVisible.value = false;
  confirmTarget.value = null;
  selectedAffiliateCompanyContractActions.value = null;
  confirmContext.value = { ...EMPTY_CONFIRM_CONTEXT };
  confirmArmed.value = false;
  confirmError.value = "";
}

function requireConfirmationPassword(value: string) {
  if (!value) {
    throw new Error("请填写当前登录密码");
  }
  return value;
}

function selectedConfirmActionEnabled(key: "confirm") {
  return (
    selectedAffiliateCompanyContractActions.value !== null &&
    selectedAffiliateCompanyContractActions.value.includes(key)
  );
}

function createForm() {
  return {
    contractReference: "",
    contractName: "",
    signedAt: todayText(),
    rightsObligationsSummary: "",
    companyEntityId: ""
  };
}

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function statusLabel(value: string) {
  return value === "confirmed" ? "已确认" : "待确认";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <t-card
    class="affiliate-company-contract"
    :bordered="true"
  >
    <header class="affiliate-company-contract__header">
      <div>
        <h2>挂靠企业与我方线下合同</h2>
        <p>
          只登记双方已经线下签署的权利义务文件；它不替代业主主合同，也不会生成业主回款或我方对下付款链。
        </p>
      </div>
      <t-button
        v-if="recordActionEnabled('record_affiliate_company_contract')"
        theme="primary"
        @click="openRecord"
      >
        登记已签线下合同
      </t-button>
    </header>

    <t-alert
      theme="warning"
      title="资金与核对边界"
      message="挂靠企业向我方拨款可以先到账、后核对，不以该合同结算完成为前提；后续关联不得覆盖银行到账事实。"
    />
    <t-alert
      v-if="notice"
      theme="success"
      :message="notice"
    />
    <t-alert
      v-if="loadError"
      theme="error"
      title="线下合同读取失败"
      :message="loadError"
    />

    <t-loading
      :loading="loading"
      show-overlay
    >
      <t-table
        row-key="id"
        :columns="columns"
        :data="data?.contracts ?? []"
        :scroll="{ x: 1350 }"
        horizontal-scroll-affixed-bottom
      >
        <template #signedAt="{ row }">
          {{ row.signedAt.slice(0, 10) }}
        </template>
        <template #status="{ row }">
          <t-tag :theme="row.status === 'confirmed' ? 'success' : 'warning'">
            {{ statusLabel(row.status) }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link
            v-if="confirmActionEnabled(row.id, 'confirm')"
            theme="primary"
            @click="openConfirm(row)"
          >
            确认
          </t-link>
        </template>
      </t-table>
    </t-loading>

    <t-drawer
      :visible="recordVisible"
      header="登记挂靠企业与我方已签线下合同"
      size="min(680px, 100vw)"
      :close-btn="!recordBusy"
      :close-on-esc-keydown="!recordBusy"
      :close-on-overlay-click="false"
      @update:visible="handleRecordVisibleChange"
    >
      <div class="affiliate-company-contract__form">
        <t-alert
          theme="warning"
          message="这里只登记双方已经线下签完的正式文件，不发起我方审批、用章、结算或付款。"
        />
        <t-input
          v-model="form.contractReference"
          label="线下合同编号"
          :disabled="recordAttempted"
        />
        <t-input
          v-model="form.contractName"
          label="线下合同名称"
          :disabled="recordAttempted"
        />
        <t-date-picker
          v-model="form.signedAt"
          label="签订日期"
          value-type="YYYY-MM-DD"
          :disabled="recordAttempted"
        />
        <t-select
          v-model="form.companyEntityId"
          label="我方签约主体"
          :disabled="recordAttempted"
          :options="companies.map((company) => ({
            label: `${company.name} · ${company.unifiedSocialCreditCode ?? '信用代码待治理'}`,
            value: company.id
          }))"
        />
        <t-textarea
          v-model="form.rightsObligationsSummary"
          label="双方权利义务摘要"
          :autosize="{ minRows: 4, maxRows: 8 }"
          maxlength="2000"
          :disabled="recordAttempted"
        />
        <t-upload
          v-model="signedFiles"
          theme="file"
          :auto-upload="false"
          :multiple="false"
          :max="1"
          :disabled="recordAttempted"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
        />
        <t-alert
          v-if="recordError"
          theme="error"
          :message="recordError"
        />
      </div>
      <template #footer>
        <t-button
          variant="outline"
          :disabled="recordBusy"
          @click="cancelRecord"
        >
          取消
        </t-button>
        <t-button
          v-if="recordArmed && recordActionEnabled('record_affiliate_company_contract')"
          theme="primary"
          :loading="recordBusy"
          @click="submitRecord"
        >
          登记并冻结文件
        </t-button>
      </template>
    </t-drawer>

    <SensitiveActionDialog
      v-if="confirmArmed && selectedConfirmActionEnabled('confirm')"
      v-model="confirmVisible"
      title="确认挂靠企业与我方线下合同"
      description="确认后合同正文、双方主体快照和文件摘要均不可覆盖或删除；此动作不是我方合同审批。"
      confirm-text="确认并冻结签名"
      :require-password="true"
      :loading="confirmBusy"
      :error="confirmError"
      @confirm="submitConfirm"
      @cancel="cancelConfirm"
    />
  </t-card>
</template>

<style scoped>
.affiliate-company-contract {
  margin-block-end: var(--jg-space-4);
}

.affiliate-company-contract__header {
  display: flex;
  gap: var(--jg-space-4);
  align-items: flex-start;
  justify-content: space-between;
  margin-block-end: var(--jg-space-4);
}

.affiliate-company-contract__header h2 {
  margin: 0;
  color: var(--jg-text-primary);
  font-size: var(--jg-font-title);
}

.affiliate-company-contract__header p {
  margin: var(--jg-space-1) 0 0;
  color: var(--jg-text-secondary);
}

.affiliate-company-contract__form {
  display: grid;
  gap: var(--jg-space-4);
}

@media (max-width: 720px) {
  .affiliate-company-contract__header {
    flex-direction: column;
  }
}
</style>
