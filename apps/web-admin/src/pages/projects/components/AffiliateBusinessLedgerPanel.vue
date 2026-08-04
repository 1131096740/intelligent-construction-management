<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PrimaryTableCol, UploadFile } from "tdesign-vue-next";
import {
  confirmProjectAffiliateContractFact,
  confirmProjectAffiliatePaymentFact,
  confirmProjectAffiliateSettlementFact,
  fetchProjectAffiliateBusinessFacts,
  fetchProjectAffiliateFactCapability,
  fetchProjectAffiliateRecordCapability,
  recordProjectAffiliateContractFact,
  recordProjectAffiliatePaymentFact,
  recordProjectAffiliateSettlementFact,
  supplementProjectAffiliateBusinessEvidence,
  uploadProjectAffiliateBusinessPrivateFile,
  uploadProjectAffiliateContractPrivateFile,
  uploadProjectAffiliatePaymentPrivateFile,
  uploadProjectAffiliateSettlementPrivateFile,
  type ProjectAffiliateBusinessFactType,
  type ProjectAffiliateBusinessFactsReadModel,
  type ProjectAffiliateContractFactReadModel,
  type ProjectAffiliateContractType,
  type ProjectAffiliateEntryKind,
  type ProjectAffiliatePaymentFactReadModel,
  type ProjectAffiliatePaymentKind,
  type ProjectAffiliateSettlementFactReadModel
} from "../../../api/core-flow-read.api";
import SensitiveActionDialog from "../../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";

const props = defineProps<{ projectId: string }>();

type RecordType = ProjectAffiliateBusinessFactType;
type AdjustmentMode = ProjectAffiliateEntryKind;
type ConfirmTarget =
  | { businessType: "contract"; fact: ProjectAffiliateContractFactReadModel }
  | { businessType: "settlement"; fact: ProjectAffiliateSettlementFactReadModel }
  | { businessType: "payment"; fact: ProjectAffiliatePaymentFactReadModel };

const data = ref<ProjectAffiliateBusinessFactsReadModel | null>(null);
const loading = ref(false);
const loadError = ref("");
const notice = ref("");
const noticeTheme = ref<"success" | "error">("success");
const activeTab = ref<RecordType>("contract");
const recordVisible = ref(false);
const recordType = ref<RecordType>("contract");
const recordMode = ref<AdjustmentMode>("original");
const recordBusy = ref(false);
const recordError = ref("");
const evidenceFiles = ref<UploadFile[]>([]);
const confirmTarget = ref<ConfirmTarget | null>(null);
const confirmVisible = ref(false);
const confirmBusy = ref(false);
const confirmError = ref("");
const supplementTarget = ref<ConfirmTarget | null>(null);
const supplementVisible = ref(false);
const supplementBusy = ref(false);
const supplementError = ref("");
const supplementDescription = ref("");
const supplementFiles = ref<UploadFile[]>([]);

const contractForm = ref(createContractForm());
const settlementForm = ref(createSettlementForm());
const paymentForm = ref(createPaymentForm());

const contractTypeOptions = [
  { label: "材料采购合同", value: "material_purchase" },
  { label: "工程机械设备租赁合同", value: "equipment_rental" },
  { label: "劳务分包合同", value: "labor_subcontract" },
  { label: "专业分包合同", value: "professional_subcontract" },
  { label: "通用结算类合同", value: "general_settlement" },
  { label: "通用直接付款合同", value: "general_direct_payment" }
] satisfies Array<{ label: string; value: ProjectAffiliateContractType }>;

const basisOptions = [
  { label: "书面依据", value: "written" },
  { label: "口头通知", value: "oral" }
];
const amountNatureOptions = [
  { label: "固定金额 / 最高限额", value: "fixed" },
  { label: "无固定总价", value: "uncapped" }
];
const paymentKindOptions = [
  { label: "正常结算付款", value: "normal" },
  { label: "合同预付款", value: "advance" },
  { label: "通用直接付款", value: "direct_contract" }
] satisfies Array<{ label: string; value: ProjectAffiliatePaymentKind }>;
const effectDirectionOptions = [
  { label: "增加", value: "increase" },
  { label: "减少", value: "decrease" }
];

const contractColumns: PrimaryTableCol[] = [
  { colKey: "externalContractReference", title: "外部合同编号", width: 180 },
  { colKey: "contractType", title: "合同类型", width: 170 },
  { colKey: "counterpartyName", title: "相对方", width: 180 },
  { colKey: "amountCents", title: "金额", width: 130 },
  { colKey: "basisType", title: "依据", width: 90 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "operation", title: "操作", fixed: "right", width: 280 }
];
const settlementColumns: PrimaryTableCol[] = [
  { colKey: "periodLabel", title: "结算期间", width: 130 },
  { colKey: "counterpartyName", title: "相对方", width: 180 },
  { colKey: "amountCents", title: "金额", width: 130 },
  { colKey: "settledAt", title: "结算日期", width: 130 },
  { colKey: "basisType", title: "依据", width: 90 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "operation", title: "操作", fixed: "right", width: 280 }
];
const paymentColumns: PrimaryTableCol[] = [
  { colKey: "externalPaymentReference", title: "外部付款流水", width: 200 },
  { colKey: "paymentKind", title: "付款类型", width: 130 },
  { colKey: "counterpartyName", title: "付款对象", width: 180 },
  { colKey: "amountCents", title: "金额", width: 130 },
  { colKey: "paidAt", title: "付款日期", width: 130 },
  { colKey: "basisType", title: "依据", width: 90 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "operation", title: "操作", fixed: "right", width: 280 }
];

const contractOptions = computed(() =>
  (data.value?.contracts ?? [])
    .filter((fact) => fact.entryKind === "original" && fact.status === "confirmed")
    .map((fact) => ({
      label: `${fact.externalContractReference} · ${fact.counterpartyName}`,
      value: fact.ledgerId
    }))
);
const settlementContractOptions = computed(() =>
  (data.value?.contracts ?? [])
    .filter(
      (fact) =>
        fact.entryKind === "original" &&
        fact.status === "confirmed" &&
        fact.contractType !== "general_direct_payment"
    )
    .map((fact) => ({
      label: `${fact.externalContractReference} · ${fact.counterpartyName}`,
      value: fact.ledgerId
    }))
);
const paymentSettlementOptions = computed(() =>
  (data.value?.settlements ?? [])
    .filter(
      (fact) =>
        fact.entryKind === "original" &&
        fact.status === "confirmed" &&
        fact.contractLedgerId === paymentForm.value.contractLedgerId
    )
    .map((fact) => ({
      label: `${fact.periodLabel} · ${formatMoney(fact.amountCents)}`,
      value: fact.ledgerId
    }))
);
const drawerTitle = computed(() => {
  const typeLabel = { contract: "合同", settlement: "结算", payment: "付款" }[recordType.value];
  const modeLabel = {
    original: "登记",
    correction: "追加更正",
    reversal: "追加反向"
  }[recordMode.value];
  return `挂靠企业对下${typeLabel}${modeLabel}`;
});
const canSubmitRecord = computed(() => !recordBusy.value);

onMounted(load);
watch(
  () => props.projectId,
  () => {
    data.value = null;
    void load();
  }
);

async function load() {
  if (!props.projectId) return;
  loading.value = true;
  loadError.value = "";
  try {
    data.value = await fetchProjectAffiliateBusinessFacts(props.projectId);
  } catch (error) {
    loadError.value = errorMessage(error, "挂靠业务持续接管台账读取失败");
  } finally {
    loading.value = false;
  }
}

function openRecord(type: RecordType) {
  recordType.value = type;
  recordMode.value = "original";
  recordError.value = "";
  evidenceFiles.value = [];
  if (type === "contract") contractForm.value = createContractForm();
  if (type === "settlement") settlementForm.value = createSettlementForm();
  if (type === "payment") paymentForm.value = createPaymentForm();
  recordVisible.value = true;
}

function openAdjustment(target: ConfirmTarget, mode: "correction" | "reversal") {
  recordType.value = target.businessType;
  recordMode.value = mode;
  recordError.value = "";
  evidenceFiles.value = [];
  if (target.businessType === "contract") {
    const fact = target.fact;
    contractForm.value = {
      contractType: fact.contractType,
      externalContractReference: fact.externalContractReference,
      counterpartyName: fact.counterpartyName,
      signedAt: dateText(fact.signedAt),
      amountNature: fact.amountNature,
      amountYuan: fact.amountCents ? centsTextToYuanText(fact.amountCents) : "",
      basisType: fact.basisType,
      advanceAllowed: fact.advanceAllowed,
      advanceLimitYuan: fact.advanceLimitCents
        ? centsTextToYuanText(fact.advanceLimitCents)
        : "",
      advanceTermsSummary: fact.advanceTermsSummary ?? "",
      effectDirection: mode === "reversal" ? "decrease" : "increase",
      description: "",
      adjustsFactId: fact.id
    };
  } else if (target.businessType === "settlement") {
    const fact = target.fact;
    settlementForm.value = {
      contractLedgerId: fact.contractLedgerId,
      counterpartyName: fact.counterpartyName,
      settledAt: dateText(fact.settledAt),
      periodLabel: fact.periodLabel,
      amountYuan: centsTextToYuanText(fact.amountCents),
      basisType: fact.basisType,
      effectDirection: mode === "reversal" ? "decrease" : "increase",
      description: "",
      adjustsFactId: fact.id
    };
  } else {
    const fact = target.fact;
    paymentForm.value = {
      contractLedgerId: fact.contractLedgerId,
      settlementLedgerId: fact.settlementLedgerId ?? "",
      counterpartyName: fact.counterpartyName,
      paidAt: dateText(fact.paidAt),
      amountYuan: centsTextToYuanText(fact.amountCents),
      paymentKind: fact.paymentKind,
      externalPaymentReference: "",
      basisType: fact.basisType,
      effectDirection: mode === "reversal" ? "decrease" : "increase",
      description: "",
      adjustsFactId: fact.id
    };
  }
  recordVisible.value = true;
}

function setEffectDirection(value: unknown) {
  const direction = value as "increase" | "decrease";
  if (recordType.value === "contract") contractForm.value.effectDirection = direction;
  else if (recordType.value === "settlement") settlementForm.value.effectDirection = direction;
  else paymentForm.value.effectDirection = direction;
}

function setBasisType(value: unknown) {
  const basisType = value as "written" | "oral";
  if (recordType.value === "contract") contractForm.value.basisType = basisType;
  else if (recordType.value === "settlement") settlementForm.value.basisType = basisType;
  else paymentForm.value.basisType = basisType;
}

function setDescription(value: unknown) {
  const description = String(value);
  if (recordType.value === "contract") contractForm.value.description = description;
  else if (recordType.value === "settlement") settlementForm.value.description = description;
  else paymentForm.value.description = description;
}

async function submitRecord() {
  recordBusy.value = true;
  recordError.value = "";
  try {
    const evidenceFile = selectedEvidenceFile(evidenceFiles.value);
    if (recordType.value === "contract") {
      const form = contractForm.value;
      const evidenceFileId = evidenceFile
        ? (
            await uploadProjectAffiliateContractEvidenceWithCapability(
              props.projectId,
              recordMode.value,
              form.adjustsFactId || undefined,
              evidenceFile
            )
          ).id
        : undefined;
      await recordProjectAffiliateContractFactWithCapability(props.projectId, {
        contractType: form.contractType,
        externalContractReference: required(form.externalContractReference, "外部合同编号"),
        counterpartyName: required(form.counterpartyName, "合同相对方"),
        signedAt: required(form.signedAt, "合同签订日期"),
        amountNature: form.amountNature,
        ...(form.amountNature === "fixed"
          ? { amountCents: positiveCents(form.amountYuan, "合同金额") }
          : {}),
        basisType: form.basisType,
        evidenceFileId,
        advanceAllowed: form.advanceAllowed,
        ...(form.advanceAllowed
          ? {
              advanceLimitCents: positiveCents(form.advanceLimitYuan, "预付款上限"),
              advanceTermsSummary: required(
                form.advanceTermsSummary,
                "预付款约定摘要"
              )
            }
          : {}),
        idempotencyKey: crypto.randomUUID(),
        entryKind: recordMode.value,
        ...(form.adjustsFactId ? { adjustsFactId: form.adjustsFactId } : {}),
        ...(recordMode.value === "correction"
          ? { effectDirection: form.effectDirection }
          : {}),
        description: form.description.trim() || undefined
      });
    } else if (recordType.value === "settlement") {
      const form = settlementForm.value;
      const evidenceFileId = evidenceFile
        ? (
            await uploadProjectAffiliateSettlementEvidenceWithCapability(
              props.projectId,
              recordMode.value,
              form.adjustsFactId || undefined,
              evidenceFile
            )
          ).id
        : undefined;
      await recordProjectAffiliateSettlementFactWithCapability(props.projectId, {
        contractLedgerId: required(form.contractLedgerId, "关联挂靠合同"),
        counterpartyName: required(form.counterpartyName, "结算相对方"),
        settledAt: required(form.settledAt, "外部结算日期"),
        periodLabel: required(form.periodLabel, "结算期间"),
        amountCents: positiveCents(form.amountYuan, "结算金额"),
        basisType: form.basisType,
        evidenceFileId,
        idempotencyKey: crypto.randomUUID(),
        entryKind: recordMode.value,
        ...(form.adjustsFactId ? { adjustsFactId: form.adjustsFactId } : {}),
        ...(recordMode.value === "correction"
          ? { effectDirection: form.effectDirection }
          : {}),
        description: form.description.trim() || undefined
      });
    } else {
      const form = paymentForm.value;
      const evidenceFileId = evidenceFile
        ? (
            await uploadProjectAffiliatePaymentEvidenceWithCapability(
              props.projectId,
              recordMode.value,
              form.adjustsFactId || undefined,
              evidenceFile
            )
          ).id
        : undefined;
      await recordProjectAffiliatePaymentFactWithCapability(props.projectId, {
        contractLedgerId: required(form.contractLedgerId, "关联挂靠合同"),
        ...(form.settlementLedgerId
          ? { settlementLedgerId: form.settlementLedgerId }
          : {}),
        counterpartyName: required(form.counterpartyName, "付款相对方"),
        paidAt: required(form.paidAt, "外部付款日期"),
        amountCents: positiveCents(form.amountYuan, "付款金额"),
        paymentKind: form.paymentKind,
        ...(recordMode.value === "original"
          ? {
              externalPaymentReference: required(
                form.externalPaymentReference,
                "外部付款唯一流水号"
              )
            }
          : {}),
        basisType: form.basisType,
        evidenceFileId,
        idempotencyKey: crypto.randomUUID(),
        entryKind: recordMode.value,
        ...(form.adjustsFactId ? { adjustsFactId: form.adjustsFactId } : {}),
        ...(recordMode.value === "correction"
          ? { effectDirection: form.effectDirection }
          : {}),
        description: form.description.trim() || undefined
      });
    }
    recordVisible.value = false;
    showNotice("外部事实已追加到不可变台账，未创建我方审批实例。");
    await load();
  } catch (error) {
    recordError.value = errorMessage(error, "外部事实登记失败");
  } finally {
    recordBusy.value = false;
  }
}

async function recordProjectAffiliateContractFactWithCapability(
  projectId: string,
  body: Parameters<typeof recordProjectAffiliateContractFact>[1] & {
    entryKind: ProjectAffiliateEntryKind;
  }
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "contract",
    body.entryKind,
    body.adjustsFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedBusinessType = capability.businessType === "contract";
  if (!matchesRequestedBusinessType) {
    throw new Error("挂靠合同登记上下文已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_affiliate_contract_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能登记该挂靠合同事实");
  return recordProjectAffiliateContractFact(projectId, body);
}

async function recordProjectAffiliateSettlementFactWithCapability(
  projectId: string,
  body: Parameters<typeof recordProjectAffiliateSettlementFact>[1] & {
    entryKind: ProjectAffiliateEntryKind;
  }
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "settlement",
    body.entryKind,
    body.adjustsFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedBusinessType = capability.businessType === "settlement";
  if (!matchesRequestedBusinessType) {
    throw new Error("挂靠结算登记上下文已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_affiliate_settlement_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能登记该挂靠结算事实");
  return recordProjectAffiliateSettlementFact(projectId, body);
}

async function recordProjectAffiliatePaymentFactWithCapability(
  projectId: string,
  body: Parameters<typeof recordProjectAffiliatePaymentFact>[1] & {
    entryKind: ProjectAffiliateEntryKind;
  }
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "payment",
    body.entryKind,
    body.adjustsFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedBusinessType = capability.businessType === "payment";
  if (!matchesRequestedBusinessType) {
    throw new Error("挂靠付款登记上下文已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_affiliate_payment_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能登记该挂靠付款事实");
  return recordProjectAffiliatePaymentFact(projectId, body);
}

async function uploadProjectAffiliateContractEvidenceWithCapability(
  projectId: string,
  entryKind: ProjectAffiliateEntryKind,
  adjustsFactId: string | undefined,
  file: File
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "contract",
    entryKind,
    adjustsFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedBusinessType = capability.businessType === "contract";
  if (!matchesRequestedBusinessType) {
    throw new Error("挂靠合同登记上下文已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_affiliate_contract_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能上传该挂靠合同依据");
  return uploadProjectAffiliateContractPrivateFile(projectId, file, file.name);
}

async function uploadProjectAffiliateSettlementEvidenceWithCapability(
  projectId: string,
  entryKind: ProjectAffiliateEntryKind,
  adjustsFactId: string | undefined,
  file: File
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "settlement",
    entryKind,
    adjustsFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedBusinessType = capability.businessType === "settlement";
  if (!matchesRequestedBusinessType) {
    throw new Error("挂靠结算登记上下文已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_affiliate_settlement_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能上传该挂靠结算依据");
  return uploadProjectAffiliateSettlementPrivateFile(projectId, file, file.name);
}

async function uploadProjectAffiliatePaymentEvidenceWithCapability(
  projectId: string,
  entryKind: ProjectAffiliateEntryKind,
  adjustsFactId: string | undefined,
  file: File
) {
  const capability = await fetchProjectAffiliateRecordCapability(
    projectId,
    "payment",
    entryKind,
    adjustsFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedBusinessType = capability.businessType === "payment";
  if (!matchesRequestedBusinessType) {
    throw new Error("挂靠付款登记上下文已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_affiliate_payment_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能上传该挂靠付款依据");
  return uploadProjectAffiliatePaymentPrivateFile(projectId, file, file.name);
}

function openConfirmation(target: ConfirmTarget) {
  confirmTarget.value = target;
  confirmError.value = "";
  confirmVisible.value = true;
}

async function submitConfirmation(values: { password: string }) {
  const target = confirmTarget.value;
  if (!target) return;
  confirmBusy.value = true;
  confirmError.value = "";
  try {
    const body = {
      confirmationPassword: required(values.password, "当前登录密码"),
      confirmationActionId: crypto.randomUUID()
    };
    if (target.businessType === "contract") {
      await confirmProjectAffiliateContractFactWithCapability(
        props.projectId,
        target.fact.id,
        body
      );
    } else if (target.businessType === "settlement") {
      await confirmProjectAffiliateSettlementFactWithCapability(
        props.projectId,
        target.fact.id,
        body
      );
    } else {
      await confirmProjectAffiliatePaymentFactWithCapability(
        props.projectId,
        target.fact.id,
        body
      );
    }
    confirmVisible.value = false;
    confirmTarget.value = null;
    showNotice("外部事实已确认并冻结当前签名版本；该动作不是我方审批。");
    await load();
  } catch (error) {
    confirmError.value = errorMessage(error, "外部事实确认失败");
  } finally {
    confirmBusy.value = false;
  }
}

async function confirmProjectAffiliateContractFactWithCapability(
  projectId: string,
  factId: string,
  body: Parameters<typeof confirmProjectAffiliateContractFact>[2]
) {
  const capability = await fetchProjectAffiliateFactCapability(
    projectId,
    "contract",
    factId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedFact = capability.factId === factId;
  if (!matchesRequestedFact) throw new Error("挂靠合同事实已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes(
    "confirm_affiliate_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能确认该挂靠外部事实");
  return confirmProjectAffiliateContractFact(projectId, factId, body);
}

async function confirmProjectAffiliateSettlementFactWithCapability(
  projectId: string,
  factId: string,
  body: Parameters<typeof confirmProjectAffiliateSettlementFact>[2]
) {
  const capability = await fetchProjectAffiliateFactCapability(
    projectId,
    "settlement",
    factId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedFact = capability.factId === factId;
  if (!matchesRequestedFact) throw new Error("挂靠结算事实已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes(
    "confirm_affiliate_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能确认该挂靠外部事实");
  return confirmProjectAffiliateSettlementFact(projectId, factId, body);
}

async function confirmProjectAffiliatePaymentFactWithCapability(
  projectId: string,
  factId: string,
  body: Parameters<typeof confirmProjectAffiliatePaymentFact>[2]
) {
  const capability = await fetchProjectAffiliateFactCapability(
    projectId,
    "payment",
    factId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedFact = capability.factId === factId;
  if (!matchesRequestedFact) throw new Error("挂靠付款事实已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes(
    "confirm_affiliate_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能确认该挂靠外部事实");
  return confirmProjectAffiliatePaymentFact(projectId, factId, body);
}

function openSupplement(target: ConfirmTarget) {
  supplementTarget.value = target;
  supplementFiles.value = [];
  supplementDescription.value = "";
  supplementError.value = "";
  supplementVisible.value = true;
}

async function submitSupplement() {
  const target = supplementTarget.value;
  if (!target) return;
  supplementBusy.value = true;
  supplementError.value = "";
  try {
    const file = selectedEvidenceFile(supplementFiles.value, true);
    if (!file) throw new Error("请选择补充外部依据文件");
    await supplementProjectAffiliateBusinessEvidenceWithCapability(
      props.projectId,
      target,
      file,
      required(supplementDescription.value, "补充依据说明")
    );
    supplementVisible.value = false;
    supplementTarget.value = null;
    showNotice("外部依据已作为新版本追加，原确认事实未被覆盖。");
    await load();
  } catch (error) {
    supplementError.value = errorMessage(error, "补充外部依据失败");
  } finally {
    supplementBusy.value = false;
  }
}

async function supplementProjectAffiliateBusinessEvidenceWithCapability(
  projectId: string,
  target: ConfirmTarget,
  file: File,
  description: string
) {
  const capability = await fetchProjectAffiliateFactCapability(
    projectId,
    target.businessType,
    target.fact.id
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const matchesRequestedFact = capability.factId === target.fact.id;
  if (!matchesRequestedFact) {
    throw new Error("挂靠外部事实已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "supplement_affiliate_evidence"
  );
  if (!operationAllowed) throw new Error("当前用户不能为该挂靠外部事实补充依据");
  const uploaded = await uploadProjectAffiliateBusinessPrivateFile(
    projectId,
    target.businessType,
    target.fact.id,
    file,
    file.name
  );
  return supplementProjectAffiliateBusinessEvidence(
    projectId,
    target.fact.id,
    {
      businessType: target.businessType,
      fileId: uploaded.id,
      idempotencyKey: crypto.randomUUID(),
      description
    }
  );
}

function targetOf(
  businessType: RecordType,
  fact:
    | ProjectAffiliateContractFactReadModel
    | ProjectAffiliateSettlementFactReadModel
    | ProjectAffiliatePaymentFactReadModel
): ConfirmTarget {
  return { businessType, fact } as ConfirmTarget;
}

function syncSettlementContract() {
  const fact = data.value?.contracts.find(
    (item) => item.ledgerId === settlementForm.value.contractLedgerId
  );
  settlementForm.value.counterpartyName = fact?.counterpartyName ?? "";
}

function syncPaymentContract() {
  const fact = data.value?.contracts.find(
    (item) => item.ledgerId === paymentForm.value.contractLedgerId
  );
  paymentForm.value.counterpartyName = fact?.counterpartyName ?? "";
  paymentForm.value.settlementLedgerId = "";
  paymentForm.value.paymentKind =
    fact?.contractType === "general_direct_payment"
      ? "direct_contract"
      : "normal";
}

function actionAvailable(
  fact: { availableActions: string[] },
  action: string
) {
  return fact.availableActions.includes(action);
}

function createContractForm() {
  return {
    contractType: "material_purchase" as ProjectAffiliateContractType,
    externalContractReference: "",
    counterpartyName: "",
    signedAt: todayText(),
    amountNature: "fixed" as "fixed" | "uncapped",
    amountYuan: "",
    basisType: "written" as "written" | "oral",
    advanceAllowed: false,
    advanceLimitYuan: "",
    advanceTermsSummary: "",
    effectDirection: "increase" as "increase" | "decrease",
    description: "",
    adjustsFactId: ""
  };
}

function createSettlementForm() {
  return {
    contractLedgerId: "",
    counterpartyName: "",
    settledAt: todayText(),
    periodLabel: "",
    amountYuan: "",
    basisType: "written" as "written" | "oral",
    effectDirection: "increase" as "increase" | "decrease",
    description: "",
    adjustsFactId: ""
  };
}

function createPaymentForm() {
  return {
    contractLedgerId: "",
    settlementLedgerId: "",
    counterpartyName: "",
    paidAt: todayText(),
    amountYuan: "",
    paymentKind: "normal" as ProjectAffiliatePaymentKind,
    externalPaymentReference: "",
    basisType: "written" as "written" | "oral",
    effectDirection: "increase" as "increase" | "decrease",
    description: "",
    adjustsFactId: ""
  };
}

function selectedEvidenceFile(files: UploadFile[], requiredFile = false) {
  const raw = files[0]?.raw;
  if (!(raw instanceof File)) {
    if (requiredFile) throw new Error("请选择外部依据文件");
    const basis =
      recordType.value === "contract"
        ? contractForm.value.basisType
        : recordType.value === "settlement"
          ? settlementForm.value.basisType
          : paymentForm.value.basisType;
    if (basis === "written") throw new Error("书面依据必须上传外部文件");
    return undefined;
  }
  return raw;
}

function positiveCents(value: string, label: string) {
  let cents: string;
  try {
    cents = yuanTextToCentsText(value.trim());
  } catch {
    throw new Error(`${label}必须填写合法金额`);
  }
  if (cents === "0") throw new Error(`${label}必须大于零`);
  return cents;
}

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`请填写${label}`);
  return normalized;
}

function formatMoney(value: string | null) {
  return value === null ? "无固定总价" : `¥${centsTextToYuanText(value)}`;
}

function formatDate(value: string) {
  return dateText(value) || "-";
}

function dateText(value: string) {
  return value ? value.slice(0, 10) : "";
}

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function contractTypeLabel(value: string) {
  return contractTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function paymentKindLabel(value: string) {
  return paymentKindOptions.find((option) => option.value === value)?.label ?? value;
}

function basisLabel(value: string) {
  return value === "written" ? "书面" : "口头";
}

function statusLabel(value: string) {
  return value === "confirmed" ? "已确认" : "待确认";
}

function showNotice(message: string) {
  noticeTheme.value = "success";
  notice.value = message;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <t-card
    class="affiliate-ledger"
    :bordered="true"
  >
    <header class="affiliate-ledger__header">
      <div>
        <h2>挂靠业务持续接管</h2>
        <p>外部合同、结算和付款只形成可复核不可变账本，不补造我方审批、用章或资金执行。</p>
      </div>
      <t-space>
        <t-button
          v-if="data?.availableActions.includes('record_contract')"
          variant="outline"
          @click="openRecord('contract')"
        >
          登记外部合同
        </t-button>
        <t-button
          v-if="data?.availableActions.includes('record_settlement')"
          variant="outline"
          @click="openRecord('settlement')"
        >
          登记外部结算
        </t-button>
        <t-button
          v-if="data?.availableActions.includes('record_payment')"
          theme="primary"
          @click="openRecord('payment')"
        >
          登记外部付款
        </t-button>
      </t-space>
    </header>

    <t-alert
      theme="warning"
      title="主体与资金边界"
      message="挂靠企业签约的合同只能由挂靠企业付款；本台账不会创建我方 PaymentRequest、PaymentExecution 或 ApprovalInstance。"
    />
    <t-alert
      v-if="notice"
      :theme="noticeTheme"
      :message="notice"
    />
    <t-alert
      v-if="loadError"
      theme="error"
      title="台账读取失败"
      :message="loadError"
    />

    <t-loading
      :loading="loading"
      show-overlay
    >
      <t-tabs v-model="activeTab">
        <t-tab-panel
          value="contract"
          :label="`外部合同 (${data?.contracts.length ?? 0})`"
        >
          <t-table
            row-key="id"
            :columns="contractColumns"
            :data="data?.contracts ?? []"
            :scroll="{ x: 1250 }"
            horizontal-scroll-affixed-bottom
          >
            <template #contractType="{ row }">
              {{ contractTypeLabel(row.contractType) }}
            </template>
            <template #amountCents="{ row }">
              {{ formatMoney(row.amountCents) }}
            </template>
            <template #basisType="{ row }">
              <t-tag :theme="row.basisType === 'written' ? 'primary' : 'warning'">
                {{ basisLabel(row.basisType) }}
              </t-tag>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'confirmed' ? 'success' : 'warning'">
                {{ statusLabel(row.status) }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <t-space size="small">
                <t-link
                  v-if="actionAvailable(row, 'confirm')"
                  theme="primary"
                  @click="openConfirmation(targetOf('contract', row))"
                >
                  确认
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'supplement_evidence')"
                  @click="openSupplement(targetOf('contract', row))"
                >
                  补充文件
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'record_correction')"
                  @click="openAdjustment(targetOf('contract', row), 'correction')"
                >
                  追加更正
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'record_reversal')"
                  theme="danger"
                  @click="openAdjustment(targetOf('contract', row), 'reversal')"
                >
                  追加反向
                </t-link>
              </t-space>
            </template>
          </t-table>
        </t-tab-panel>

        <t-tab-panel
          value="settlement"
          :label="`外部结算 (${data?.settlements.length ?? 0})`"
        >
          <t-table
            row-key="id"
            :columns="settlementColumns"
            :data="data?.settlements ?? []"
            :scroll="{ x: 1150 }"
            horizontal-scroll-affixed-bottom
          >
            <template #amountCents="{ row }">
              {{ formatMoney(row.amountCents) }}
            </template>
            <template #settledAt="{ row }">
              {{ formatDate(row.settledAt) }}
            </template>
            <template #basisType="{ row }">
              <t-tag :theme="row.basisType === 'written' ? 'primary' : 'warning'">
                {{ basisLabel(row.basisType) }}
              </t-tag>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'confirmed' ? 'success' : 'warning'">
                {{ statusLabel(row.status) }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <t-space size="small">
                <t-link
                  v-if="actionAvailable(row, 'confirm')"
                  theme="primary"
                  @click="openConfirmation(targetOf('settlement', row))"
                >
                  确认
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'supplement_evidence')"
                  @click="openSupplement(targetOf('settlement', row))"
                >
                  补充文件
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'record_correction')"
                  @click="openAdjustment(targetOf('settlement', row), 'correction')"
                >
                  追加更正
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'record_reversal')"
                  theme="danger"
                  @click="openAdjustment(targetOf('settlement', row), 'reversal')"
                >
                  追加反向
                </t-link>
              </t-space>
            </template>
          </t-table>
        </t-tab-panel>

        <t-tab-panel
          value="payment"
          :label="`外部付款 (${data?.payments.length ?? 0})`"
        >
          <t-table
            row-key="id"
            :columns="paymentColumns"
            :data="data?.payments ?? []"
            :scroll="{ x: 1350 }"
            horizontal-scroll-affixed-bottom
          >
            <template #paymentKind="{ row }">
              {{ paymentKindLabel(row.paymentKind) }}
            </template>
            <template #amountCents="{ row }">
              {{ formatMoney(row.amountCents) }}
            </template>
            <template #paidAt="{ row }">
              {{ formatDate(row.paidAt) }}
            </template>
            <template #basisType="{ row }">
              <t-tag :theme="row.basisType === 'written' ? 'primary' : 'warning'">
                {{ basisLabel(row.basisType) }}
              </t-tag>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'confirmed' ? 'success' : 'warning'">
                {{ statusLabel(row.status) }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <t-space size="small">
                <t-link
                  v-if="actionAvailable(row, 'confirm')"
                  theme="primary"
                  @click="openConfirmation(targetOf('payment', row))"
                >
                  确认
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'supplement_evidence')"
                  @click="openSupplement(targetOf('payment', row))"
                >
                  补充文件
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'record_correction')"
                  @click="openAdjustment(targetOf('payment', row), 'correction')"
                >
                  追加更正
                </t-link>
                <t-link
                  v-if="actionAvailable(row, 'record_reversal')"
                  theme="danger"
                  @click="openAdjustment(targetOf('payment', row), 'reversal')"
                >
                  追加反向
                </t-link>
              </t-space>
            </template>
          </t-table>
        </t-tab-panel>
      </t-tabs>
    </t-loading>

    <t-drawer
      v-model:visible="recordVisible"
      :header="drawerTitle"
      size="min(720px, 100vw)"
      :close-on-overlay-click="false"
    >
      <div class="affiliate-ledger__form">
        <t-alert
          v-if="recordMode !== 'original'"
          theme="warning"
          message="更正和反向将追加新事实，不会覆盖或删除已确认原记录。反向金额必须等于当前有效金额。"
        />

        <template v-if="recordType === 'contract'">
          <t-select
            v-model="contractForm.contractType"
            label="合同类型"
            :options="contractTypeOptions"
            :disabled="recordMode !== 'original'"
          />
          <t-input
            v-model="contractForm.externalContractReference"
            label="外部合同编号"
            :disabled="recordMode !== 'original'"
          />
          <t-input
            v-model="contractForm.counterpartyName"
            label="合同相对方"
            :disabled="recordMode !== 'original'"
          />
          <t-date-picker
            v-model="contractForm.signedAt"
            label="签订日期"
            value-type="YYYY-MM-DD"
            :disabled="recordMode !== 'original'"
          />
          <t-select
            v-model="contractForm.amountNature"
            label="金额性质"
            :options="amountNatureOptions"
            :disabled="recordMode !== 'original'"
          />
          <t-input
            v-if="contractForm.amountNature === 'fixed'"
            v-model="contractForm.amountYuan"
            label="合同金额（元）"
          />
          <t-switch
            v-model="contractForm.advanceAllowed"
            label="冻结预付款约定"
            :disabled="recordMode !== 'original'"
          />
          <template v-if="contractForm.advanceAllowed">
            <t-input
              v-model="contractForm.advanceLimitYuan"
              label="预付款上限（元）"
              :disabled="recordMode !== 'original'"
            />
            <t-textarea
              v-model="contractForm.advanceTermsSummary"
              label="预付款约定摘要"
              :disabled="recordMode !== 'original'"
            />
          </template>
        </template>

        <template v-else-if="recordType === 'settlement'">
          <t-select
            v-model="settlementForm.contractLedgerId"
            label="已确认外部合同"
            :options="settlementContractOptions"
            :disabled="recordMode !== 'original'"
            @change="syncSettlementContract"
          />
          <t-input
            v-model="settlementForm.counterpartyName"
            label="结算相对方"
            disabled
          />
          <t-date-picker
            v-model="settlementForm.settledAt"
            label="结算日期"
            value-type="YYYY-MM-DD"
          />
          <t-input
            v-model="settlementForm.periodLabel"
            label="结算期间"
          />
          <t-input
            v-model="settlementForm.amountYuan"
            label="结算金额（元）"
          />
        </template>

        <template v-else>
          <t-select
            v-model="paymentForm.contractLedgerId"
            label="已确认外部合同"
            :options="contractOptions"
            :disabled="recordMode !== 'original'"
            @change="syncPaymentContract"
          />
          <t-select
            v-model="paymentForm.paymentKind"
            label="付款类型"
            :options="paymentKindOptions"
            :disabled="recordMode !== 'original'"
          />
          <t-select
            v-if="paymentForm.paymentKind === 'normal'"
            v-model="paymentForm.settlementLedgerId"
            label="已确认外部结算"
            :options="paymentSettlementOptions"
            :disabled="recordMode !== 'original'"
          />
          <t-input
            v-model="paymentForm.counterpartyName"
            label="付款相对方"
            disabled
          />
          <t-date-picker
            v-model="paymentForm.paidAt"
            label="付款日期"
            value-type="YYYY-MM-DD"
          />
          <t-input
            v-model="paymentForm.amountYuan"
            label="付款金额（元）"
          />
          <t-input
            v-if="recordMode === 'original'"
            v-model="paymentForm.externalPaymentReference"
            label="外部付款唯一流水号"
          />
        </template>

        <t-select
          v-if="recordMode === 'correction'"
          :model-value="
            recordType === 'contract'
              ? contractForm.effectDirection
              : recordType === 'settlement'
                ? settlementForm.effectDirection
                : paymentForm.effectDirection
          "
          label="金额调整方向"
          :options="effectDirectionOptions"
          @change="setEffectDirection"
        />
        <t-select
          :model-value="
            recordType === 'contract'
              ? contractForm.basisType
              : recordType === 'settlement'
                ? settlementForm.basisType
                : paymentForm.basisType
          "
          label="事实依据"
          :options="basisOptions"
          @change="setBasisType"
        />
        <t-upload
          v-model="evidenceFiles"
          theme="file-input"
          :auto-upload="false"
          :max="1"
          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
          placeholder="选择外部合同、结算或付款依据"
        />
        <t-textarea
          :model-value="
            recordType === 'contract'
              ? contractForm.description
              : recordType === 'settlement'
                ? settlementForm.description
                : paymentForm.description
          "
          label="说明"
          @change="setDescription"
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
          @click="recordVisible = false"
        >
          取消
        </t-button>
        <t-button
          theme="primary"
          :loading="recordBusy"
          :disabled="!canSubmitRecord"
          @click="submitRecord"
        >
          追加到台账
        </t-button>
      </template>
    </t-drawer>

    <SensitiveActionDialog
      v-model="confirmVisible"
      title="确认挂靠外部业务事实"
      description="确认后业务字段不可覆盖；系统冻结当前签名版本并写审计，但不会创建我方审批实例。"
      confirm-text="确认并冻结"
      :require-password="true"
      :loading="confirmBusy"
      :error="confirmError"
      @confirm="submitConfirmation"
      @cancel="confirmTarget = null"
    />

    <t-drawer
      v-model:visible="supplementVisible"
      header="补充外部依据"
      size="min(560px, 100vw)"
      :close-on-overlay-click="false"
    >
      <div class="affiliate-ledger__form">
        <t-alert
          theme="info"
          message="补充文件将作为独占的新证据版本追加，不修改已确认事实。"
        />
        <t-upload
          v-model="supplementFiles"
          theme="file-input"
          :auto-upload="false"
          :max="1"
          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
        />
        <t-textarea
          v-model="supplementDescription"
          label="补充依据说明"
        />
        <t-alert
          v-if="supplementError"
          theme="error"
          :message="supplementError"
        />
      </div>
      <template #footer>
        <t-button
          variant="outline"
          :disabled="supplementBusy"
          @click="supplementVisible = false"
        >
          取消
        </t-button>
        <t-button
          theme="primary"
          :loading="supplementBusy"
          @click="submitSupplement"
        >
          追加依据
        </t-button>
      </template>
    </t-drawer>
  </t-card>
</template>

<style scoped>
.affiliate-ledger {
  display: grid;
  gap: var(--jg-space-lg);
}

.affiliate-ledger__header {
  align-items: flex-start;
  display: flex;
  gap: var(--jg-space-lg);
  justify-content: space-between;
}

.affiliate-ledger__header h2,
.affiliate-ledger__header p {
  margin: 0;
}

.affiliate-ledger__header p {
  color: var(--jg-color-text-secondary);
  margin-top: var(--jg-space-xs);
}

.affiliate-ledger__form {
  display: grid;
  gap: var(--jg-space-md);
  padding-bottom: var(--jg-space-xl);
}

@media (max-width: 768px) {
  .affiliate-ledger__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
