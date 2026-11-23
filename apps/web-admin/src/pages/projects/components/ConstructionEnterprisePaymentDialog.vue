<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  fetchProjectAffiliateBusinessFacts,
  fetchProjectAffiliateRecordCapability,
  fetchProjectUpstreamFundRecordCapability,
  fetchProjectUpstreamFundReferenceOptions,
  recordProjectAffiliatePaymentFact,
  recordProjectUpstreamFundFact,
  uploadProjectAffiliatePaymentPrivateFile,
  uploadProjectUpstreamFundPrivateFile,
  type ProjectAffiliateContractFactReadModel,
  type ProjectAffiliatePaymentRequestOptionReadModel,
  type ProjectAffiliateSettlementFactReadModel,
  type ProjectUpstreamFundReferenceOptionsReadModel,
  type RecordProjectAffiliatePaymentFactPayload,
  type RecordProjectUpstreamFundFactPayload
} from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";

const props = defineProps<{
  modelValue: boolean;
  projectId: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [visible: boolean];
  saved: [];
}>();

type Branch = "downstream" | "remittance";
const branch = ref<Branch>("downstream");
const loading = ref(false);
const submitting = ref(false);
const message = ref("");
const error = ref("");
const contracts = ref<ProjectAffiliateContractFactReadModel[]>([]);
const settlements = ref<ProjectAffiliateSettlementFactReadModel[]>([]);
const reference = ref<ProjectUpstreamFundReferenceOptionsReadModel | null>(null);
const paymentRequestOptions = ref<ProjectAffiliatePaymentRequestOptionReadModel[]>([]);
const evidenceFile = ref<File | null>(null);
const idempotencyKey = ref(crypto.randomUUID());
const paymentCapability = ref<string[]>([]);
const remittanceCapability = ref<string[]>([]);

const downstreamForm = reactive({
  contractLedgerId: "",
  settlementLedgerId: "",
  counterpartyName: "",
  paidAt: today(),
  amountYuan: "",
  externalPaymentReference: "",
  paymentRequestId: "",
  basisType: "written" as "written" | "oral",
  description: ""
});
const remittanceForm = reactive({
  companyEntityId: "",
  affiliateCompanyContractId: "",
  affiliateSettlementFactId: "",
  invoiceRecordId: "",
  counterpartyName: "",
  occurredAt: today(),
  amountYuan: "",
  basisType: "written" as "written" | "oral",
  description: ""
});

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});
const confirmedContracts = computed(() =>
  contracts.value.filter((contract) => contract.status === "confirmed")
);
const confirmedSettlements = computed(() =>
  settlements.value.filter(
    (settlement) =>
      settlement.status === "confirmed" &&
      (branch.value === "downstream"
        ? settlement.contractLedgerId === downstreamForm.contractLedgerId
        : false)
  )
);
const selectedDownstreamContract = computed(() =>
  confirmedContracts.value.find(
    (contract) => contract.id === downstreamForm.contractLedgerId
  )
);
const remittanceSettlements = computed(() =>
  (reference.value?.affiliateSettlements ?? []).filter(
    (settlement) =>
      settlement.affiliateCompanyContractId === remittanceForm.affiliateCompanyContractId
  )
);
const selectedRemittanceContract = computed(() =>
  (reference.value?.affiliateCompanyContracts ?? []).find(
    (contract) => contract.id === remittanceForm.affiliateCompanyContractId
  )
);
const selectedRemittanceSettlement = computed(() =>
  remittanceSettlements.value.find(
    (settlement) => settlement.id === remittanceForm.affiliateSettlementFactId
  )
);

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatYuan(value: string | null | undefined) {
  return value ? `¥${centsTextToYuanText(value)}` : "—";
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    error.value = "";
    message.value = "";
    evidenceFile.value = null;
    idempotencyKey.value = crypto.randomUUID();
    loading.value = true;
    try {
      const [facts, options, paymentActions, remittanceActions] =
        await Promise.all([
          fetchProjectAffiliateBusinessFacts(props.projectId),
          fetchProjectUpstreamFundReferenceOptions(props.projectId),
          fetchProjectAffiliateRecordCapability(
            props.projectId,
            "payment",
            "original"
          ),
          fetchProjectUpstreamFundRecordCapability(props.projectId)
        ]);
      paymentCapability.value = paymentActions.availableActions;
      remittanceCapability.value = remittanceActions.availableActions;
      contracts.value = facts.contracts;
      settlements.value = facts.settlements;
      reference.value = options;
      paymentRequestOptions.value = (options.affiliatePaymentRequests ?? []).filter(
        (request) => request.sourceType === "settlement"
      );
    } catch (loadError) {
      error.value = formatUnknownApiError(
        loadError,
        "施工企业付款参照资料读取失败"
      );
    } finally {
      loading.value = false;
    }
  }
);

watch(
  () => downstreamForm.contractLedgerId,
  () => {
    const contract = selectedDownstreamContract.value;
    if (contract) downstreamForm.counterpartyName = contract.counterpartyName;
    if (
      downstreamForm.settlementLedgerId &&
      !confirmedSettlements.value.some(
        (settlement) => settlement.ledgerId === downstreamForm.settlementLedgerId
      )
    ) {
      downstreamForm.settlementLedgerId = "";
    }
  }
);
watch(
  () => remittanceForm.affiliateCompanyContractId,
  () => {
    const contract = selectedRemittanceContract.value;
    if (contract) remittanceForm.counterpartyName = contract.companyEntityNameSnapshot;
    if (
      remittanceForm.affiliateSettlementFactId &&
      !remittanceSettlements.value.some(
        (settlement) => settlement.id === remittanceForm.affiliateSettlementFactId
      )
    ) {
      remittanceForm.affiliateSettlementFactId = "";
    }
  }
);
watch(
  () => remittanceForm.affiliateSettlementFactId,
  () => {
    const settlement = selectedRemittanceSettlement.value;
    if (!settlement) return;
    const contract = selectedRemittanceContract.value;
    if (contract) remittanceForm.companyEntityId = contract.companyEntityId;
  }
);

function selectEvidence(event: Event) {
  const input = event.target as HTMLInputElement;
  evidenceFile.value = input.files?.[0] ?? null;
}

async function uploadDownstreamEvidenceWithCapability(
  projectId: string,
  file: File
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "payment",
    "original"
  );
  const allowed = capability.availableActions.includes(
    "record_affiliate_payment_fact"
  );
  if (!allowed) throw new Error("当前账号不能登记施工企业付下游");
  const uploaded = await uploadProjectAffiliatePaymentPrivateFile(
    projectId,
    file,
    file.name,
    crypto.randomUUID()
  );
  return uploaded.id;
}

async function recordDownstreamWithCapability(
  projectId: string,
  body: RecordProjectAffiliatePaymentFactPayload
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "payment",
    "original"
  );
  const allowed = capability.availableActions.includes(
    "record_affiliate_payment_fact"
  );
  if (!allowed) throw new Error("当前账号不能登记施工企业付下游");
  return recordProjectAffiliatePaymentFact(projectId, body);
}

async function uploadRemittanceEvidenceWithCapability(
  projectId: string,
  file: File
) {
  const capability = await fetchProjectUpstreamFundRecordCapability(projectId);
  const allowed = capability.availableActions.includes(
    "record_upstream_fund_fact"
  );
  if (!allowed) throw new Error("当前账号不能登记施工企业转我方到账");
  const uploaded = await uploadProjectUpstreamFundPrivateFile(
    projectId,
    file,
    file.name,
    crypto.randomUUID()
  );
  return uploaded.id;
}

async function recordRemittanceWithCapability(
  projectId: string,
  body: RecordProjectUpstreamFundFactPayload
) {
  const capability = await fetchProjectUpstreamFundRecordCapability(projectId);
  const allowed = capability.availableActions.includes(
    "record_upstream_fund_fact"
  );
  if (!allowed) throw new Error("当前账号不能登记施工企业转我方到账");
  return recordProjectUpstreamFundFact(projectId, body);
}

async function submit() {
  submitting.value = true;
  error.value = "";
  message.value = "";
  try {
    if (branch.value === "downstream") {
      if (!downstreamForm.amountYuan.trim()) throw new Error("请填写付款金额");
      if (!downstreamForm.externalPaymentReference.trim()) {
        throw new Error("请填写外部付款唯一流水号，防止同一笔重复登记");
      }
      if (downstreamForm.basisType === "written" && !evidenceFile.value) {
        throw new Error("书面依据必须上传付款依据文件");
      }
      const evidenceFileId = evidenceFile.value
        ? await uploadDownstreamEvidenceWithCapability(
            props.projectId,
            evidenceFile.value
          )
        : undefined;
      await recordDownstreamWithCapability(props.projectId, {
        contractLedgerId: downstreamForm.contractLedgerId,
        settlementLedgerId: downstreamForm.settlementLedgerId || undefined,
        counterpartyName: downstreamForm.counterpartyName,
        paidAt: downstreamForm.paidAt,
        amountCents: yuanTextToCentsText(downstreamForm.amountYuan),
        paymentKind: "normal",
        externalPaymentReference: downstreamForm.externalPaymentReference.trim(),
        paymentRequestId: downstreamForm.paymentRequestId || undefined,
        basisType: downstreamForm.basisType,
        evidenceFileId,
        description: downstreamForm.description || undefined,
        idempotencyKey: idempotencyKey.value
      });
      message.value = "施工企业付下游已登记待独立确认；同一笔外部流水不能重复登记。";
    } else {
      if (!remittanceForm.amountYuan.trim()) throw new Error("请填写到账金额");
      if (
        !remittanceForm.companyEntityId ||
        !remittanceForm.affiliateCompanyContractId ||
        !remittanceForm.affiliateSettlementFactId ||
        !remittanceForm.invoiceRecordId
      ) {
        throw new Error("转我方必须保留公司、对上合同、结算和发票完整链路");
      }
      if (remittanceForm.basisType === "written" && !evidenceFile.value) {
        throw new Error("书面依据必须上传到账依据文件");
      }
      const evidenceFileId = evidenceFile.value
        ? await uploadRemittanceEvidenceWithCapability(
            props.projectId,
            evidenceFile.value
          )
        : undefined;
      const result = (await recordRemittanceWithCapability(props.projectId, {
        factType: "affiliate_remittance_to_company",
        basisType: remittanceForm.basisType,
        occurredAt: remittanceForm.occurredAt,
        amountCents: yuanTextToCentsText(remittanceForm.amountYuan),
        counterpartyName: remittanceForm.counterpartyName,
        companyEntityId: remittanceForm.companyEntityId,
        affiliateCompanyContractId: remittanceForm.affiliateCompanyContractId,
        affiliateSettlementFactId: remittanceForm.affiliateSettlementFactId,
        invoiceRecordId: remittanceForm.invoiceRecordId,
        evidenceFileId,
        description: remittanceForm.description || undefined,
        idempotencyKey: idempotencyKey.value
      })) as { settlementCoverage?: { overpaidCents: string } | null };
      const overpaid = result.settlementCoverage?.overpaidCents;
      message.value =
        overpaid && overpaid !== "0"
          ? `施工企业转我方已登记待独立确认；该结算已超付 ${formatYuan(overpaid)}，未改写真实金额。`
          : "施工企业转我方已登记待独立确认。";
    }
    emit("saved");
  } catch (submitError) {
    error.value = formatUnknownApiError(submitError, "施工企业付款登记失败");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <t-dialog
    v-model:visible="visible"
    header="登记施工企业付款"
    width="720px"
    :confirm-btn="{ content: '登记并汇总', loading: submitting }"
    @confirm="submit"
  >
    <div class="construction-payment-dialog">
      <t-alert
        theme="info"
        message="按真实凭据登记施工企业已付：付下游与转我方都归入同一「施工企业已付金额」，不新增审批，但必须有对应已确认结算；真实超付如实登记并提示。"
      />
      <t-radio-group
        v-model="branch"
        variant="default-filled"
      >
        <t-radio-button value="downstream">付下游</t-radio-button>
        <t-radio-button value="remittance">转我方（关联到账）</t-radio-button>
      </t-radio-group>

      <div
        v-if="loading"
        class="construction-payment-dialog__hint"
      >
        正在读取合同、结算与付款申请参照资料
      </div>

      <form
        v-else-if="branch === 'downstream'"
        class="construction-payment-dialog__form"
        @submit.prevent="submit"
      >
        <label>
          施工企业合同
          <t-select
            v-model="downstreamForm.contractLedgerId"
            placeholder="选择已确认施工企业合同"
            :options="confirmedContracts.map((contract) => ({
              label: `${contract.counterpartyName} · ${contract.externalContractReference}`,
              value: contract.id
            }))"
          />
        </label>
        <label>
          对应已确认结算
          <t-select
            v-model="downstreamForm.settlementLedgerId"
            placeholder="选择已确认结算（先有结算再付款）"
            :options="confirmedSettlements.map((settlement) => ({
              label: `${settlement.periodLabel} · ${formatYuan(settlement.amountCents)}`,
              value: settlement.ledgerId
            }))"
          />
        </label>
        <label>
          收款方
          <t-input
            v-model="downstreamForm.counterpartyName"
            maxlength="200"
            placeholder="选择合同后自动带出，须与合同相对方一致"
          />
        </label>
        <label>
          付款日期
          <t-date-picker
            v-model="downstreamForm.paidAt"
            format="YYYY-MM-DD"
          />
        </label>
        <label>
          实际付款金额（元）
          <t-input
            v-model="downstreamForm.amountYuan"
            placeholder="按真实凭据填写；超过结算金额时如实登记并提示超付"
          />
        </label>
        <label>
          外部付款唯一流水号
          <t-input
            v-model="downstreamForm.externalPaymentReference"
            maxlength="200"
            placeholder="同一笔付款不能换个单号重复登记"
          />
        </label>
        <label>
          系统付款申请（可选带出）
          <t-select
            v-model="downstreamForm.paymentRequestId"
            clearable
            placeholder="有已审批施工企业付款申请时选择"
            :options="paymentRequestOptions.map((request) => ({
              label: `${request.code} · 可付 ${formatYuan(request.remainingAmountCents)}`,
              value: request.id
            }))"
          />
        </label>
        <label>
          依据类型
          <t-radio-group v-model="downstreamForm.basisType">
            <t-radio value="written">书面凭据</t-radio>
            <t-radio value="oral">口头通知</t-radio>
          </t-radio-group>
        </label>
        <label>
          付款依据文件
          <!-- ui-rules-ignore: native-file-input; private payment evidence picker. -->
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
            @change="selectEvidence"
          >
        </label>
        <label>
          说明
          <t-input
            v-model="downstreamForm.description"
            maxlength="500"
          />
        </label>
      </form>

      <form
        v-else
        class="construction-payment-dialog__form"
        @submit.prevent="submit"
      >
        <label>
          我方合同
          <t-select
            v-model="remittanceForm.affiliateCompanyContractId"
            placeholder="选择已确认对上合同"
            :options="(reference?.affiliateCompanyContracts ?? []).map((contract) => ({
              label: `${contract.companyEntityNameSnapshot} · ${contract.contractReference}`,
              value: contract.id
            }))"
          />
        </label>
        <label>
          对应已确认结算
          <t-select
            v-model="remittanceForm.affiliateSettlementFactId"
            placeholder="选择已确认对上结算"
            :options="remittanceSettlements.map((settlement) => ({
              label: `${settlement.periodLabel} · ${formatYuan(settlement.amountCents)}`,
              value: settlement.id
            }))"
          />
        </label>
        <label>
          我方公司
          <t-input
            :model-value="selectedRemittanceContract?.companyEntityNameSnapshot ?? ''"
            disabled
          />
        </label>
        <label>
          到账日期
          <t-date-picker
            v-model="remittanceForm.occurredAt"
            format="YYYY-MM-DD"
          />
        </label>
        <label>
          实际到账金额（元）
          <t-input
            v-model="remittanceForm.amountYuan"
          />
        </label>
        <label>
          对应发票
          <t-select
            v-model="remittanceForm.invoiceRecordId"
            placeholder="选择我方开具给施工企业的有效发票"
            :options="(reference?.invoices ?? []).map((invoice) => ({
              label: `${invoice.invoiceCode ?? invoice.invoiceNumber ?? invoice.externalIdentifier ?? invoice.id} · ${formatYuan(invoice.totalAmountCents)}`,
              value: invoice.id
            }))"
          />
        </label>
        <label>
          依据类型
          <t-radio-group v-model="remittanceForm.basisType">
            <t-radio value="written">书面凭据</t-radio>
            <t-radio value="oral">口头通知</t-radio>
          </t-radio-group>
        </label>
        <label>
          到账依据文件
          <!-- ui-rules-ignore: native-file-input; private remittance evidence picker. -->
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
            @change="selectEvidence"
          >
        </label>
        <label>
          说明
          <t-input
            v-model="remittanceForm.description"
            maxlength="500"
          />
        </label>
        <t-alert
          theme="normal"
          message="转我方只增加我方到账与施工企业已付，不确认项目收入；我方后续再付下游不计入施工企业直接已付。"
        />
      </form>

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
    </div>
  </t-dialog>
</template>

<style scoped>
.construction-payment-dialog {
  display: grid;
  gap: 16px;
}
.construction-payment-dialog__hint {
  color: var(--jg-text-secondary);
  font-size: 13px;
}
.construction-payment-dialog__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.construction-payment-dialog__form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--jg-text-secondary);
}
@media (max-width: 720px) {
  .construction-payment-dialog__form {
    grid-template-columns: 1fr;
  }
}
</style>
