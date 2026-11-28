<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  confirmConstructionPaymentCorrection,
  confirmProjectUpstreamFundFact,
  fetchConstructionPaymentCorrectionCapability,
  fetchProjectConstructionEnterpriseDeductionCapability,
  fetchProjectConstructionEnterpriseDeductions,
  recordProjectConstructionEnterpriseDeduction,
  requestConstructionPaymentCorrection,
  uploadProjectUpstreamFundPrivateFile,
  type ConfirmConstructionPaymentCorrectionPayload,
  type ProjectConstructionEnterpriseDeductionListItemReadModel,
  type ProjectConstructionEnterpriseDeductionPageReadModel,
  type RecordProjectConstructionEnterpriseDeductionPayload,
  type RequestConstructionPaymentCorrectionPayload
} from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
  canConfirmWritten: boolean;
  canConfirmOral: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [visible: boolean];
  saved: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});

const loading = ref(false);
const error = ref("");
const message = ref("");
const page = ref<ProjectConstructionEnterpriseDeductionPageReadModel | null>(null);
const items = ref<ProjectConstructionEnterpriseDeductionListItemReadModel[]>([]);
const capability = ref<string[]>([]);
const correctionCapability = ref<string[]>([]);

const registration = reactive({
  feeName: "",
  amountYuan: "",
  occurredAt: today(),
  evidenceFile: null as File | null
});
const registrationSubmitting = ref(false);
const registrationError = ref("");
const registrationAttempt = ref<{
  body: {
    feeName: string;
    amountCents: string;
    occurredAt: string;
    evidenceFileId?: string;
    idempotencyKey: string;
  };
} | null>(null);

const confirmationVisible = ref(false);
const confirmationTarget = ref<ProjectConstructionEnterpriseDeductionListItemReadModel | null>(null);
const confirmationPassword = ref("");
const confirmationError = ref("");
const confirmationSubmitting = ref(false);

const correctionVisible = ref(false);
const correctionTarget = ref<ProjectConstructionEnterpriseDeductionListItemReadModel | null>(null);
const correctionStage = ref<"request" | "confirm">("request");
const correctionSubmitting = ref(false);
const correctionError = ref("");
const correctionEvidenceFile = ref<File | null>(null);
const correctionForm = reactive({
  feeName: "",
  amountYuan: "",
  occurredAt: "",
  correctionReason: "",
  confirmationPassword: "",
  confirmationActionId: crypto.randomUUID(),
  selfReviewReason: ""
});

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatYuan(value: string | null | undefined) {
  return value ? `¥${centsTextToYuanText(value)}` : "—";
}

function dateText(value: string) {
  return value.slice(0, 10);
}

function statusLabel(row: ProjectConstructionEnterpriseDeductionListItemReadModel) {
  if (row.entryKind === "reversal") return "反冲";
  if (row.entryKind === "correction") return "更正重登";
  return row.status === "confirmed" ? "已确认" : "待确认";
}

function canRecord() {
  return capability.value.includes("record_construction_enterprise_deduction");
}

function canConfirm(row: ProjectConstructionEnterpriseDeductionListItemReadModel) {
  if (row.status !== "pending_confirm" || row.entryKind !== "original") return false;
  return row.basisType === "oral" ? props.canConfirmOral : props.canConfirmWritten;
}

function canRequestCorrection() {
  return correctionCapability.value.includes(
    "request_construction_payment_correction"
  );
}

function canConfirmCorrection() {
  return correctionCapability.value.includes(
    "confirm_construction_payment_correction"
  );
}

async function load(reset = true) {
  loading.value = true;
  error.value = "";
  try {
    const [result, recordCapability, correction] = await Promise.all([
      fetchProjectConstructionEnterpriseDeductions(props.projectId, {
        cursor: reset ? undefined : page.value?.nextCursor ?? undefined,
        pageSize: 100
      }),
      reset
        ? fetchProjectConstructionEnterpriseDeductionCapability(props.projectId)
        : Promise.resolve({ projectId: props.projectId, availableActions: capability.value }),
      reset
        ? fetchConstructionPaymentCorrectionCapability(props.projectId)
        : Promise.resolve({ projectId: props.projectId, availableActions: correctionCapability.value })
    ]);
    capability.value = recordCapability.availableActions;
    correctionCapability.value = correction.availableActions;
    items.value = reset ? result.items : [...items.value, ...result.items];
    page.value = result;
  } catch (loadError) {
    error.value = formatUnknownApiError(loadError, "施工企业扣费明细读取失败");
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    message.value = "";
    registrationError.value = "";
    confirmationError.value = "";
    correctionError.value = "";
    void load(true);
  }
);

async function recordDeductionWithCapability(
  projectId: string,
  body: RecordProjectConstructionEnterpriseDeductionPayload
) {
  const capability = await fetchProjectConstructionEnterpriseDeductionCapability(projectId);
  const allowed = capability.availableActions.includes(
    "record_construction_enterprise_deduction"
  );
  if (!allowed) throw new Error("当前账号不能登记施工企业扣费");
  return recordProjectConstructionEnterpriseDeduction(projectId, body);
}

async function requestDeductionCorrectionWithCapability(
  projectId: string,
  body: RequestConstructionPaymentCorrectionPayload
) {
  const capability = await fetchConstructionPaymentCorrectionCapability(projectId);
  const allowed = capability.availableActions.includes(
    "request_construction_payment_correction"
  );
  if (!allowed) throw new Error("当前账号不能提出扣费更正");
  return requestConstructionPaymentCorrection(projectId, body);
}

async function confirmDeductionCorrectionWithCapability(
  projectId: string,
  sourceType: "affiliate_deduction",
  originalFactId: string,
  body: ConfirmConstructionPaymentCorrectionPayload
) {
  const capability = await fetchConstructionPaymentCorrectionCapability(projectId);
  const allowed = capability.availableActions.includes(
    "confirm_construction_payment_correction"
  );
  if (!allowed) throw new Error("扣费更正必须由财务主管确认");
  return confirmConstructionPaymentCorrection(
    projectId,
    sourceType,
    originalFactId,
    body
  );
}

async function submitRegistration() {
  if (registrationSubmitting.value) return;
  registrationSubmitting.value = true;
  registrationError.value = "";
  try {
    if (!canRecord()) throw new Error("当前账号不能登记施工企业扣费");
    let attempt = registrationAttempt.value;
    if (!attempt) {
      const evidenceFileId = registration.evidenceFile
        ? (await uploadProjectUpstreamFundPrivateFile(
            props.projectId,
            registration.evidenceFile,
            registration.evidenceFile.name,
            crypto.randomUUID()
          )).id
        : undefined;
      attempt = {
        body: {
          feeName: registration.feeName.trim(),
          amountCents: yuanTextToCentsText(registration.amountYuan),
          occurredAt: registration.occurredAt,
          ...(evidenceFileId ? { evidenceFileId } : {}),
          idempotencyKey: crypto.randomUUID()
        }
      };
      registrationAttempt.value = attempt;
    }
    const evidenceAttached = Boolean(attempt.body.evidenceFileId);
    await recordDeductionWithCapability(props.projectId, attempt.body);
    registrationAttempt.value = null;
    registration.feeName = "";
    registration.amountYuan = "";
    registration.occurredAt = today();
    registration.evidenceFile = null;
    message.value = evidenceAttached
      ? "扣费已登记待确认；书面依据已引用，确认后才会减少施工企业持有资金。"
      : "扣费已登记待确认；未附依据按口头通知由财务主管确认后才计入。";
    await load(true);
    emit("saved");
  } catch (submitError) {
    registrationError.value = formatUnknownApiError(
      submitError,
      "登记施工企业扣费失败"
    );
  } finally {
    registrationSubmitting.value = false;
  }
}

function selectRegistrationEvidence(event: Event) {
  registration.evidenceFile =
    (event.target as HTMLInputElement).files?.[0] ?? null;
}

function selectCorrectionEvidence(event: Event) {
  correctionEvidenceFile.value =
    (event.target as HTMLInputElement).files?.[0] ?? null;
}

function retryRegistration() {
  registrationAttempt.value = null;
  void submitRegistration();
}

function openConfirmation(row: ProjectConstructionEnterpriseDeductionListItemReadModel) {
  confirmationTarget.value = row;
  confirmationPassword.value = "";
  confirmationError.value = "";
  confirmationVisible.value = true;
}

async function submitConfirmation() {
  const row = confirmationTarget.value;
  if (!row) return;
  confirmationSubmitting.value = true;
  confirmationError.value = "";
  try {
    if (!confirmationPassword.value.trim()) throw new Error("请输入当前登录密码");
    await confirmProjectUpstreamFundFact(props.projectId, row.id, {
      confirmationPassword: confirmationPassword.value,
      confirmationActionId: crypto.randomUUID()
    });
    confirmationVisible.value = false;
    message.value = "扣费已确认；施工企业持有资金减少，施工企业已付金额不变。";
    await load(true);
    emit("saved");
  } catch (submitError) {
    confirmationError.value = formatUnknownApiError(submitError, "确认施工企业扣费失败");
  } finally {
    confirmationSubmitting.value = false;
  }
}

function openCorrection(row: ProjectConstructionEnterpriseDeductionListItemReadModel) {
  correctionTarget.value = row;
  correctionStage.value = "request";
  correctionError.value = "";
  correctionEvidenceFile.value = null;
  correctionForm.feeName = row.feeName;
  correctionForm.amountYuan = centsTextToYuanText(row.amountCents);
  correctionForm.occurredAt = dateText(row.occurredAt);
  correctionForm.correctionReason = "";
  correctionForm.confirmationPassword = "";
  correctionForm.confirmationActionId = crypto.randomUUID();
  correctionForm.selfReviewReason = "";
  correctionVisible.value = true;
}

async function submitCorrectionRequest() {
  const row = correctionTarget.value;
  if (!row) return;
  correctionSubmitting.value = true;
  correctionError.value = "";
  try {
    if (!canRequestCorrection()) throw new Error("当前账号不能提出扣费更正");
    if (!correctionForm.correctionReason.trim()) throw new Error("请填写更正原因");
    const evidenceFileId = correctionEvidenceFile.value
      ? (await uploadProjectUpstreamFundPrivateFile(
          props.projectId,
          correctionEvidenceFile.value,
          correctionEvidenceFile.value.name,
          crypto.randomUUID()
        )).id
      : undefined;
    await requestDeductionCorrectionWithCapability(props.projectId, {
      sourceType: "affiliate_deduction",
      originalFactId: row.id,
      correctionReason: correctionForm.correctionReason.trim(),
      idempotencyKey: crypto.randomUUID(),
      feeName: correctionForm.feeName.trim(),
      amountCents: correctionForm.amountYuan.trim()
        ? yuanTextToCentsText(correctionForm.amountYuan)
        : undefined,
      occurredAt: correctionForm.occurredAt || undefined,
      ...(evidenceFileId ? { evidenceFileId } : {})
    });
    correctionStage.value = "confirm";
    message.value = "更正已提出（反转 + 重登），等待财务主管确认。";
  } catch (submitError) {
    correctionError.value = formatUnknownApiError(submitError, "提出施工企业扣费更正失败");
  } finally {
    correctionSubmitting.value = false;
  }
}

async function submitCorrectionConfirmation() {
  const row = correctionTarget.value;
  if (!row) return;
  correctionSubmitting.value = true;
  correctionError.value = "";
  try {
    if (!canConfirmCorrection()) throw new Error("扣费更正必须由财务主管确认");
    if (!correctionForm.confirmationPassword.trim()) throw new Error("请输入当前登录密码");
    await confirmDeductionCorrectionWithCapability(
      props.projectId,
      "affiliate_deduction",
      row.id,
      {
        confirmationPassword: correctionForm.confirmationPassword,
        confirmationActionId: correctionForm.confirmationActionId,
        selfReviewReason: correctionForm.selfReviewReason.trim() || undefined
      }
    );
    correctionVisible.value = false;
    message.value = "扣费更正已确认；原记录保留，净额与施工企业持有资金同步更新。";
    await load(true);
    emit("saved");
  } catch (submitError) {
    correctionError.value = formatUnknownApiError(submitError, "确认施工企业扣费更正失败");
  } finally {
    correctionSubmitting.value = false;
  }
}
</script>

<template>
  <t-drawer
    v-model:visible="visible"
    header="施工企业扣费"
    size="900px"
    :footer="false"
  >
    <div class="construction-deduction-drawer">
      <t-alert
        theme="info"
        message="扣费按费用名称 + 实际金额简单登记，已有依据可附。确认后只减少施工企业账上项目资金；不计入施工企业已付，也不自动形成收入或利润。"
      />
      <t-alert
        v-if="message"
        theme="success"
        :message="message"
      />
      <t-alert
        v-if="error"
        theme="warning"
        :message="error"
      />

      <div
        v-if="page"
        class="construction-deduction-drawer__summary"
      >
        <div>
          <span>已确认扣费净额</span>
          <strong>{{ formatYuan(page.summary.deductedCents) }}</strong>
        </div>
        <div>
          <span>待确认扣费</span>
          <strong>{{ formatYuan(page.summary.pendingCents) }}</strong>
        </div>
        <div>
          <span>施工企业已付金额</span>
          <strong>不含扣费</strong>
        </div>
      </div>

      <section
        v-if="canRecord()"
        class="construction-deduction-drawer__form"
      >
        <h3>登记扣费</h3>
        <label>
          费用名称
          <t-input
            v-model="registration.feeName"
            maxlength="100"
            placeholder="如：管理费、税金、质保金"
            :disabled="registrationSubmitting || registrationAttempt !== null"
          />
        </label>
        <label>
          实际金额（元）
          <t-input
            v-model="registration.amountYuan"
            placeholder="按实际扣费金额填写"
            :disabled="registrationSubmitting || registrationAttempt !== null"
          />
        </label>
        <label>
          发生日期
          <t-date-picker
            v-model="registration.occurredAt"
            format="YYYY-MM-DD"
            :disabled="registrationSubmitting || registrationAttempt !== null"
          />
        </label>
        <label>
          依据文件（选填）
          <!-- ui-rules-ignore: native-file-input; private deduction evidence picker. -->
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
            :disabled="registrationSubmitting || registrationAttempt !== null"
            @change="selectRegistrationEvidence"
          >
        </label>
        <t-alert
          v-if="registrationAttempt"
          theme="warning"
          message="正在重试上次扣费登记，将沿用原费用名称、金额、日期和依据。"
        />
        <t-alert
          v-if="registrationError"
          theme="warning"
          :message="registrationError"
        />
        <div class="construction-deduction-drawer__actions">
          <t-button
            v-if="registrationAttempt"
            variant="outline"
            :loading="registrationSubmitting"
            @click="retryRegistration"
          >
            重试原登记
          </t-button>
          <t-button
            v-else
            :loading="registrationSubmitting"
            @click="submitRegistration"
          >
            登记扣费
          </t-button>
        </div>
      </section>

      <t-table
        row-key="id"
        :data="items"
        :columns="[
          { colKey: 'occurredAt', title: '日期', width: 110 },
          { colKey: 'feeName', title: '费用名称', minWidth: 150 },
          { colKey: 'amount', title: '金额', width: 130, align: 'right' },
          { colKey: 'basisType', title: '依据', width: 100 },
          { colKey: 'status', title: '状态', width: 110 },
          { colKey: 'actions', title: '操作', width: 130 }
        ]"
        :loading="loading"
        size="small"
      >
        <template #occurredAt="{ row }">
          {{ dateText(row.occurredAt) }}
        </template>
        <template #feeName="{ row }">
          <span>{{ row.feeName || "—" }}</span>
          <small v-if="row.entryKind !== 'original'">
            （关联原扣费 {{ row.adjustsFactId?.slice(0, 8) }}）
          </small>
        </template>
        <template #amount="{ row }">
          <span :class="{ 'construction-deduction-drawer__negative': row.direction === 'decrease' }">
            {{ row.direction === "decrease" ? "-" : "" }}{{ formatYuan(row.amountCents) }}
          </span>
        </template>
        <template #basisType="{ row }">
          {{ row.basisType === "written" ? "书面依据" : "口头通知" }}
          <small v-if="row.evidenceFileId">（已附）</small>
        </template>
        <template #status="{ row }">
          <t-tag
            :theme="row.status === 'confirmed' ? 'success' : 'warning'"
            variant="light"
          >
            {{ statusLabel(row) }}
          </t-tag>
        </template>
        <template #actions="{ row }">
          <t-button
            v-if="canConfirm(row)"
            size="small"
            variant="text"
            @click="openConfirmation(row)"
          >
            确认
          </t-button>
          <t-button
            v-else-if="row.correctable && canRequestCorrection()"
            size="small"
            variant="text"
            @click="openCorrection(row)"
          >
            更正
          </t-button>
          <span v-else>—</span>
        </template>
      </t-table>

      <t-button
        v-if="page?.nextCursor"
        variant="outline"
        :loading="loading"
        @click="load(false)"
      >
        加载更多
      </t-button>
    </div>

    <t-dialog
      v-model:visible="confirmationVisible"
      header="确认施工企业扣费"
      width="460px"
      :confirm-btn="{
        content: '确认扣费',
        loading: confirmationSubmitting
      }"
      @confirm="submitConfirmation"
    >
      <div class="construction-deduction-drawer__dialog">
        <t-alert
          theme="normal"
          message="确认后扣费才进入施工企业持有资金口径；施工企业已付金额不变。"
        />
        <label>
          当前登录密码
          <t-input
            v-model="confirmationPassword"
            type="password"
            autocomplete="current-password"
          />
        </label>
        <t-alert
          v-if="confirmationError"
          theme="warning"
          :message="confirmationError"
        />
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="correctionVisible"
      header="更正施工企业扣费"
      width="560px"
      :confirm-btn="{
        content: correctionStage === 'request' ? '提出更正' : '财务主管确认',
        loading: correctionSubmitting,
        disabled: correctionStage === 'confirm' && !canConfirmCorrection()
      }"
      @confirm="correctionStage === 'request' ? submitCorrectionRequest() : submitCorrectionConfirmation()"
    >
      <div class="construction-deduction-drawer__dialog">
        <t-alert
          v-if="correctionStage === 'confirm' && !canConfirmCorrection()"
          theme="warning"
          message="更正已提出，须由财务主管在本人账号下确认。"
        />
        <label>
          更正后费用名称
          <t-input
            v-model="correctionForm.feeName"
            maxlength="100"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <label>
          更正后金额（元）
          <t-input
            v-model="correctionForm.amountYuan"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <label>
          更正后发生日期
          <t-date-picker
            v-model="correctionForm.occurredAt"
            format="YYYY-MM-DD"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <label>
          新依据文件（选填，不选保留原依据）
          <!-- ui-rules-ignore: native-file-input; private deduction correction evidence picker. -->
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
            :disabled="correctionStage === 'confirm'"
            @change="selectCorrectionEvidence"
          >
        </label>
        <label>
          更正原因
          <t-input
            v-model="correctionForm.correctionReason"
            maxlength="500"
            :disabled="correctionStage === 'confirm'"
          />
        </label>
        <template v-if="correctionStage === 'confirm'">
          <t-alert
            theme="normal"
            message="更正采用「反转 + 重登」：原扣费保留，反向事实冲回后重登正确值。"
          />
          <label>
            自审原因（本人提出并确认时必填）
            <t-input
              v-model="correctionForm.selfReviewReason"
              maxlength="500"
            />
          </label>
          <label>
            当前登录密码
            <t-input
              v-model="correctionForm.confirmationPassword"
              type="password"
              autocomplete="current-password"
            />
          </label>
        </template>
        <t-alert
          v-if="correctionError"
          theme="warning"
          :message="correctionError"
        />
      </div>
    </t-dialog>
  </t-drawer>
</template>

<style scoped>
.construction-deduction-drawer {
  display: grid;
  gap: 16px;
}
.construction-deduction-drawer__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.construction-deduction-drawer__summary div {
  display: grid;
  gap: 6px;
  padding: 12px;
  background: var(--jg-surface-muted);
  border-radius: var(--jg-radius-md);
}
.construction-deduction-drawer__summary span {
  color: var(--jg-text-secondary);
  font-size: 13px;
}
.construction-deduction-drawer__summary strong {
  font-size: 18px;
}
.construction-deduction-drawer__negative {
  color: var(--jg-danger);
}
.construction-deduction-drawer__form {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-md);
}
.construction-deduction-drawer__form h3 {
  margin: 0;
  font-size: 15px;
}
.construction-deduction-drawer__form label,
.construction-deduction-drawer__dialog label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--jg-text-secondary);
}
.construction-deduction-drawer__actions {
  display: flex;
  justify-content: flex-end;
}
.construction-deduction-drawer__dialog {
  display: grid;
  gap: 12px;
}
@media (max-width: 720px) {
  .construction-deduction-drawer__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
