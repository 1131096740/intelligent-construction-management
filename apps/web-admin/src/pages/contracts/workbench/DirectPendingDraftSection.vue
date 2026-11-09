<template>
  <section
    class="direct-pending"
    aria-label="已签合同资料"
  >
    <h1>已签合同资料</h1>
    <p v-if="sourceState === 'unavailable' || sourceState === 'invalid'">
      已签合同资料暂时无法核对，请稍后再试。
    </p>
    <p
      v-else
      class="original-number"
    >
      {{ aggregate.draft.originalSignedNumber ?? (upwardMarker && aggregate.draft.originalSignedNumber === undefined ? "原合同编号待核对" : "未注明编号") }}
    </p>
    <t-alert
      theme="info"
      message="资料仅保存为草稿，后续登记尚未开放。"
    />

    <p
      v-if="readOnlyMessage"
      role="status"
    >
      {{ readOnlyMessage }}
    </p>
    <div class="direct-fields">
      <label>
        原合同编号
        <t-input
          :value="aggregate.draft.originalSignedNumber ?? ''"
          :disabled="locked"
          @change="setNumber"
        />
      </label>
      <label>
        合同名称
        <t-input
          :value="aggregate.draft.contractName"
          :disabled="locked"
          @change="patch({ contractName: String($event) })"
        />
      </label>
      <label>
        签订日期（选填）
        <t-input
          :value="(upwardMarker ?? marker)?.signedOn ?? ''"
          placeholder="YYYY-MM-DD"
          :disabled="locked"
          @change="setSignedOn"
        />
      </label>
      <label>
        业务类型
        <t-select
          :value="basics.businessType"
          :options="businessTypes"
          :disabled="locked || upwardMarker !== null"
          @change="setBasic('businessType', String($event))"
        />
      </label>
      <label>
        合同金额（元）
        <t-input
          :value="aggregate.draft.manualAmountYuan ?? ''"
          placeholder="金额待确定"
          :disabled="locked"
          @change="setAmount"
        />
      </label>
      <label>
        金额口径
        <t-select
          :value="basics.amountBasis"
          :options="amountBases"
          :disabled="locked"
          @change="setBasic('amountBasis', String($event))"
        />
      </label>
      <label>
        发票情况
        <t-select
          :value="basics.invoiceStatus"
          :options="invoiceOptions"
          :disabled="locked"
          @change="setInvoice"
        />
      </label>
      <label>
        税率口径
        <t-select
          :value="aggregate.draft.taxMode"
          :options="taxModes"
          :disabled="locked"
          @change="setTaxMode"
        />
      </label>
      <label>
        默认税率（%）
        <t-input
          :value="aggregate.draft.defaultTaxRatePercent ?? ''"
          placeholder="选填"
          :disabled="locked"
          @change="patch({ defaultTaxRatePercent: String($event) || null })"
        />
      </label>
    </div>
    <t-space break-line>
      <t-button
        variant="outline"
        :disabled="locked || !aggregate.draft.originalSignedNumber"
        :loading="checkingNumber"
        @click="checkNumber"
      >
        核对同号
      </t-button>
      <span
        v-if="numberMessage"
        role="status"
      >{{ numberMessage }}</span>
    </t-space>
    <label class="text-field">
      结算约定原文
      <t-textarea
        :value="basics.settlementText"
        :disabled="locked"
        @change="setBasic('settlementText', String($event))"
      />
    </label>
    <t-checkbox
      :checked="aggregate.paymentTerms !== null"
      :disabled="locked || Boolean(marker?.fixedPaymentTermsVersionId)"
      @change="setPaymentTermsRecorded"
    >
      记录付款约定原文
    </t-checkbox>
    <label
      v-if="aggregate.paymentTerms !== null"
      class="text-field"
    >
      付款约定原文
      <t-textarea
        :value="aggregate.paymentTerms.originalText"
        :disabled="locked"
        @change="setPaymentText"
      />
    </label>
    <p v-else>
      未填写付款约定
    </p>

    <h2>签约双方</h2>
    <div v-if="upwardMarker" class="direct-fields">
      <div class="party-side">
        <strong>项目施工企业</strong>
        <p>{{ upwardSubjects?.enterprise?.name ?? "当前项目没有可核对的施工企业" }}</p>
        <t-select
          :value="upwardMarker.enterpriseParty?.roleKey"
          :options="upwardRoleOptions"
          placeholder="选择施工企业签署位置"
          :disabled="locked"
          @change="selectUpwardRole"
        />
      </div>
      <div class="party-side">
        <strong>项目参与的本公司</strong>
        <p>{{ upwardMarker.companyParty?.roleKey === "party_a" ? "甲方" : upwardMarker.companyParty?.roleKey === "party_b" ? "乙方" : "请先选择施工企业签署位置" }}</p>
        <t-select
          :value="aggregate.draft.companyEntityId || undefined"
          :options="upwardCompanyOptions"
          placeholder="选择项目参与公司"
          :disabled="locked"
          @change="selectUpwardCompany"
        />
      </div>
    </div>
    <template v-else>
      <div class="direct-fields">
        <label>
          合作单位名称
          <t-input
            v-model="partyQuery"
            :disabled="locked"
            placeholder="填写单位名称后查找"
          />
        </label>
        <div class="inline-actions">
          <t-button
            variant="outline"
            :loading="partyBusy"
            :disabled="locked"
            @click="searchParties"
          >
            查找单位
          </t-button>
        </div>
      </div>
      <p
        v-if="partyMessage"
        role="status"
      >
        {{ partyMessage }}
      </p>
      <div class="direct-fields">
        <div
          v-for="side in sides"
          :key="side.key"
          class="party-side"
        >
          <strong>{{ side.label }}</strong>
          <p>{{ selectedPartyName(side.key) || "未选择单位资料" }}</p>
          <t-select
            :value="partyChoices[side.key]?.id"
            :options="partyOptions"
            :placeholder="'选择' + side.label"
            :disabled="locked || partyOptions.length === 0"
            @change="selectParty(side.key, String($event))"
          />
          <t-select
            v-if="partyChoices[side.key]"
            :value="selectedVersion(side.key)"
            :options="partyChoices[side.key]?.versions"
            :placeholder="'选择' + side.label + '资料版本'"
            :disabled="locked"
            @change="selectPartyVersion(side.key, String($event))"
          />
          <t-button
            v-if="marker?.[side.key]"
            size="small"
            variant="text"
            :disabled="locked"
            @click="clearParty(side.key)"
          >
            移除{{ side.label }}
          </t-button>
        </div>
      </div>
    </template>

    <h2>签章原件</h2>
    <p>按纸面顺序保存 PDF 或 JPEG、PNG 照片，最多二十份。</p>
    <!-- ui-rules-ignore: native-file-input - 本地原件选择须由用户显式触发。 -->
    <input
      ref="fileInput"
      type="file"
      aria-label="上传签章原件"
      hidden
      multiple
      accept="application/pdf,image/jpeg,image/png"
      :disabled="locked || pendingFiles.length > 0 || aggregate.attachments.length >= 20"
      @change="onFilesSelected"
    >
    <t-space break-line>
      <t-button
        variant="outline"
        :disabled="locked || pendingFiles.length > 0 || aggregate.attachments.length >= 20"
        @click="fileInput?.click()"
      >
        选择 PDF 或照片
      </t-button>
      <t-button
        v-if="pendingFiles.length && !uploading"
        variant="outline"
        :disabled="locked"
        @click="uploadRemaining"
      >
        重试剩余原件
      </t-button>
      <t-button
        v-if="pendingFiles.length && !uploading"
        variant="text"
        :disabled="locked"
        @click="discardPendingFiles"
      >
        取消剩余原件
      </t-button>
    </t-space>
    <p
      v-if="uploading"
      role="status"
    >
      正在上传原件
    </p>
    <p
      v-if="uploadMessage"
      role="alert"
    >
      {{ uploadMessage }}
    </p>
    <ul
      v-if="aggregate.attachments.length"
      class="originals"
    >
      <li
        v-for="(attachment, index) in aggregate.attachments"
        :key="attachment.fileId"
      >
        <span>{{ fileNames[attachment.fileId] || '原件 ' + (index + 1) }}</span>
        <small>{{ savedFileIds[index] === attachment.fileId ? "已随草稿保存" : savedFileIds.includes(attachment.fileId) ? "顺序待保存" : "已上传，待保存" }}</small>
        <t-space break-line>
          <t-button
            size="small"
            variant="text"
            :aria-label="'上移原件 ' + (index + 1)"
            :disabled="locked || index === 0 || pendingFiles.length > 0"
            @click="moveAttachment(index, -1)"
          >
            上移
          </t-button>
          <t-button
            size="small"
            variant="text"
            :aria-label="'下移原件 ' + (index + 1)"
            :disabled="locked || index === aggregate.attachments.length - 1 || pendingFiles.length > 0"
            @click="moveAttachment(index, 1)"
          >
            下移
          </t-button>
          <t-button
            size="small"
            variant="text"
            :aria-label="'移除原件 ' + (index + 1)"
            :disabled="locked || pendingFiles.length > 0"
            @click="removeAttachment(index)"
          >
            移除
          </t-button>
        </t-space>
      </li>
    </ul>

    <t-space break-line>
      <t-button
        theme="primary"
        :loading="saving"
        :disabled="locked || pendingFiles.length > 0 || !upwardSaveComplete"
        @click="emit('save')"
      >
        保存草稿
      </t-button>
      <t-button
        v-if="pendingResult"
        variant="outline"
        :loading="checking"
        :disabled="!online"
        @click="emit('check-result')"
      >
        核对保存结果
      </t-button>
      <t-button
        v-if="canRefresh"
        variant="outline"
        @click="emit('refresh')"
      >
        刷新编辑状态
      </t-button>
    </t-space>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="saved && !dirty"
      role="status"
    >
      {{ savedThenUpdated ? "原草稿已保存，随后有更新，当前显示最新资料。" : sourceState === "complete" ? "草稿已保存，资料齐备" : sourceState === "invalid" ? "草稿已保存，资料待核对" : "草稿已保存，资料待补充" }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref } from "vue";
import { getBusinessParty, listBusinessParties,
  type ContractDraftAttachmentModel, type ContractDraftPartyModel, type ContractDraftPaymentTermsModel } from "../../../api/contract-workbench.api";
import { fetchContractLedger, type PrivateFileReadModel } from "../../../api/core-flow-read.api";
import { directLocatedParty, directOriginalSlot, directPendingBusinessTypes, directSigningMarker, sameDirectParty, upwardSigningMarker,
  type DirectInputState, type PendingSigningMarker, type UpwardDraftSubjects, type UpwardPartyRole } from "./direct-pending-draft";
import type { ContractDraftAggregateModel, ContractDraftFieldsModel } from "./use-contract-draft";

const props = defineProps<{
  contractId: string;
  versionId: string;
  captureReadContext: () => (() => boolean) | undefined;
  uploadOriginal: (file: File, key: string) => Promise<PrivateFileReadModel>;
  sourceState: DirectInputState;
  aggregate: ContractDraftAggregateModel;
  upwardSubjects: UpwardDraftSubjects | null;
  savedFileIds: string[];
  disabled: boolean;
  online: boolean;
  canRefresh: boolean;
  readOnlyMessage: string;
  saving: boolean;
  saved: boolean;
  savedThenUpdated: boolean;
  dirty: boolean;
  pendingResult: boolean;
  checking: boolean;
  error: string;
}>();
const emit = defineEmits<{
  "patch-draft": [value: Partial<ContractDraftFieldsModel>];
  "set-payment-terms": [value: ContractDraftPaymentTermsModel | null];
  "set-parties": [parties: ContractDraftPartyModel[], marker: PendingSigningMarker, companyEntityId?: string];
  "set-attachments": [value: ContractDraftAttachmentModel[]];
  save: [];
  "check-result": [];
  refresh: [];
}>();

const marker = computed(() => directSigningMarker(props.aggregate.draft.extraDraftData.directSigningInput));
const upwardMarker = computed(() => upwardSigningMarker(props.aggregate.draft.extraDraftData.directSigningInput));
const upwardRoleOptions = [{ value: "party_a", label: "甲方" }, { value: "party_b", label: "乙方" }];
const upwardCompanyOptions = computed(() => props.upwardSubjects?.companies.map(company => ({ value: company.companyEntityId, label: company.name })) ?? []);
const upwardSaveComplete = computed(() => !upwardMarker.value || Boolean(upwardMarker.value.enterpriseParty && upwardMarker.value.companyParty &&
  upwardCompanyOptions.value.some(company => company.value === props.aggregate.draft.companyEntityId) &&
  props.aggregate.draft.contractName.trim() && props.aggregate.attachments.length > 0));
const basics = computed(() => props.aggregate.draft.extraDraftData.contractBasics as {
  businessType: string; amountBasis: string; invoiceStatus: string; settlementText: string;
} ?? { businessType: "", amountBasis: "", invoiceStatus: "", settlementText: "" });
const businessTypes = directPendingBusinessTypes;
const amountBases = [{ value: "tax_inclusive", label: "含税金额" }, { value: "tax_exclusive", label: "不含税金额" }];
const invoiceOptions = [{ value: "pending", label: "待确定" }, { value: "none", label: "无发票" },
  { value: "vat_general", label: "增值税普通发票" }, { value: "vat_special", label: "增值税专用发票" }];
const taxModes = [{ value: "single_rate", label: "单一税率" }, { value: "multiple_rate", label: "多种税率" }];
const checkingNumber = ref(false);
const numberMessage = ref("");
const partyBusy = ref(false);
const uploading = ref(false);
const locked = computed(() => props.disabled || uploading.value || partyBusy.value ||
  Boolean(upwardMarker.value && (!props.upwardSubjects?.enterprise || upwardCompanyOptions.value.length === 0)));
let alive = true;
onScopeDispose(() => { alive = false; });

function patch(value: Partial<ContractDraftFieldsModel>) {
  if (!locked.value) emit("patch-draft", value);
}
function setNumber(value: string | number) {
  numberMessage.value = "";
  patch({ originalSignedNumber: String(value) || null });
}
function setAmount(value: string | number) {
  patch({ manualAmountYuan: String(value) || null, amountSource: "manual" });
}
function setSignedOn(value: string | number) {
  const current = upwardMarker.value ?? marker.value;
  if (current) patch({ extraDraftData: { ...props.aggregate.draft.extraDraftData,
    directSigningInput: { ...current, signedOn: String(value) || null } } });
}
function setBasic(key: string, value: string) {
  patch({ extraDraftData: { ...props.aggregate.draft.extraDraftData, contractBasics: { ...basics.value, [key]: value } } });
}
function setInvoice(value: unknown) {
  if (typeof value !== "string" || !invoiceOptions.some(option => option.value === value)) return;
  patch({ extraDraftData: { ...props.aggregate.draft.extraDraftData, contractBasics: { ...basics.value, invoiceStatus: value } },
    invoiceType: value === "vat_general" || value === "vat_special" ? value : null });
}
function setTaxMode(value: unknown) {
  if (value === "single_rate" || value === "multiple_rate") patch({ taxMode: value });
}
function setPaymentTermsRecorded(value: unknown) {
  if (!locked.value && !marker.value?.fixedPaymentTermsVersionId) emit("set-payment-terms", value === true ? { originalText: "", stages: [] } : null);
}
function setPaymentText(value: string | number) {
  if (!locked.value && props.aggregate.paymentTerms !== null) emit("set-payment-terms", { originalText: String(value), stages: [] });
}
async function checkNumber() {
  const number = props.aggregate.draft.originalSignedNumber;
  const current = props.captureReadContext();
  if (!number || locked.value || checkingNumber.value || !current?.()) return;
  checkingNumber.value = true;
  numberMessage.value = "";
  try {
    const { rows } = await fetchContractLedger({ retryUnauthorized: false, responseIsCurrent: current });
    if (!alive || !current() || props.disabled || number !== props.aggregate.draft.originalSignedNumber) return;
    const match = rows.some(row => row.originalSignedNumberState === "available" && row.originalSignedNumber === number &&
      typeof row.contractId === "string" && typeof row.contractVersionId === "string" &&
      (row.contractId !== props.contractId || row.contractVersionId !== props.versionId));
    if (match) numberMessage.value = "可见近期台账中有相同原编号，仍可保存。";
  } catch {
    if (alive && current() && !props.disabled && number === props.aggregate.draft.originalSignedNumber) numberMessage.value = "暂时无法核对近期台账，仍可保存。";
  } finally { checkingNumber.value = false; }
}

function selectUpwardCompany(value: unknown) {
  const current = upwardMarker.value;
  if (locked.value || !current || !upwardCompanyOptions.value.some(company => company.value === value)) return;
  emit("set-parties", props.aggregate.parties, current, String(value));
}

function selectUpwardRole(role: unknown) {
  const current = upwardMarker.value;
  const enterprise = props.upwardSubjects?.enterprise;
  if (locked.value || !current || !enterprise || (role !== "party_a" && role !== "party_b")) return;
  const other: UpwardPartyRole = role === "party_a" ? "party_b" : "party_a";
  const enterpriseParty = { roleKey: role, displayOrder: 0 } as const;
  emit("set-parties", [{ ...enterpriseParty, businessPartyVersionId: enterprise.businessPartyVersionId, snapshot: { name: enterprise.name } }],
    { ...current, enterpriseParty, companyParty: { roleKey: other, displayOrder: 0 } });
}

type Side = "enterpriseParty" | "counterpartyParty";
const sides = [{ key: "enterpriseParty", label: "施工企业", roleKey: "party_a" },
  { key: "counterpartyParty", label: "相对方", roleKey: "party_b" }] as const;
type PartyOption = { value: string; label: string };
type VersionOption = PartyOption & { name: string };
const partyQuery = ref("");
const partyMessage = ref("");
const partyOptions = ref<PartyOption[]>([]);
const partyChoices = reactive<Partial<Record<Side, { id: string; versions: VersionOption[] }>>>({});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function searchParties() {
  const current = props.captureReadContext();
  if (locked.value || !current?.()) return;
  partyBusy.value = true;
  partyMessage.value = "";
  try {
    const result = await listBusinessParties(partyQuery.value, { retryUnauthorized: false, responseIsCurrent: current });
    if (!alive || !current() || props.disabled) return;
    partyOptions.value = result.flatMap(item => {
      const party = asRecord(item);
      return party?.status === "active" && typeof party.id === "string" && party.id && typeof party.name === "string"
        ? [{ value: party.id, label: party.name }] : [];
    });
    if (!partyOptions.value.length) partyMessage.value = "未找到可用单位资料。";
  } catch {
    if (alive && current() && !props.disabled) partyMessage.value = "暂时无法查找单位，当前选择已保留。";
  } finally { partyBusy.value = false; }
}

async function selectParty(side: Side, partyId: string) {
  const current = props.captureReadContext();
  if (locked.value || !current?.() || !partyOptions.value.some(item => item.value === partyId)) return;
  partyBusy.value = true;
  partyMessage.value = "";
  try {
    const result = asRecord(await getBusinessParty(partyId, { retryUnauthorized: false, responseIsCurrent: current }));
    if (!alive || !current() || props.disabled) return;
    const party = asRecord(result?.party);
    if (party?.id !== partyId || party.status !== "active" || !Array.isArray(result?.versions)) throw new Error();
    const versions = result.versions.flatMap(item => {
      const version = asRecord(item);
      const identity = asRecord(version?.snapshot);
      return version?.businessPartyId === partyId && typeof version.id === "string" && version.id &&
        Number.isSafeInteger(version.versionNo) && Number(version.versionNo) > 0 && typeof identity?.name === "string" && identity.name
        ? [{ value: version.id, label: `${identity.name} · 版本 ${version.versionNo}`, name: identity.name }] : [];
    });
    if (versions.length === 0 || new Set(versions.map(version => version.value)).size !== versions.length) throw new Error();
    const other = oppositeParty(side);
    if (other && (other.businessPartyId === partyId || versions.some(version => version.value === other.businessPartyVersionId))) {
      partyMessage.value = "签约双方请选择不同的合作单位。";
      return;
    }
    partyChoices[side] = { id: partyId, versions };
  } catch {
    if (alive && current() && !props.disabled) partyMessage.value = "暂时无法核对单位资料版本，当前选择已保留。";
  } finally { partyBusy.value = false; }
}

function selectedParty(side: Side) {
  return directLocatedParty(props.aggregate.parties, marker.value?.[side]);
}
function oppositeParty(side: Side) {
  return selectedParty(side === "enterpriseParty" ? "counterpartyParty" : "enterpriseParty");
}
function selectedPartyName(side: Side) {
  const name = selectedParty(side)?.snapshot.name;
  return typeof name === "string" ? name : "";
}
function selectedVersion(side: Side) { return selectedParty(side)?.businessPartyVersionId; }
function selectPartyVersion(side: Side, versionId: string) {
  const current = marker.value;
  const choice = partyChoices[side];
  const version = choice?.versions.find(item => item.value === versionId);
  const roleKey = sides.find(item => item.key === side)?.roleKey;
  if (locked.value || !current || !choice || !version || !roleKey) return;
  const other = oppositeParty(side);
  const oldParty = selectedParty(side);
  const next = props.aggregate.parties.filter(party => party !== oldParty);
  const usedPositions = new Set(next.filter(party => party.roleKey === roleKey).map(party => party.displayOrder));
  let displayOrder = 0;
  while (usedPositions.has(displayOrder)) displayOrder += 1;
  const party = { roleKey, displayOrder, businessPartyId: choice.id, businessPartyVersionId: version.value, snapshot: { name: version.name } };
  if (sameDirectParty(party, other) || choice.versions.some(item => item.value === other?.businessPartyVersionId)) {
    partyMessage.value = "签约双方请选择不同的合作单位。";
    return;
  }
  partyMessage.value = "";
  next.push(party);
  emit("set-parties", next, { ...current, [side]: { roleKey, displayOrder } });
}
function clearParty(side: Side) {
  const current = marker.value;
  if (locked.value || !current?.[side]) return;
  const party = selectedParty(side);
  delete partyChoices[side];
  emit("set-parties", props.aggregate.parties.filter(item => item !== party), { ...current, [side]: null });
}

const fileInput = ref<HTMLInputElement | null>(null);
const pendingFiles = ref<Array<{ file: File; key: string }>>([]);
const fileNames = reactive<Record<string, string>>({});
const uploadMessage = ref("");
const validMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

async function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length || locked.value || pendingFiles.value.length) return;
  if (props.aggregate.attachments.length + files.length > 20 || files.some(file => !validMimeTypes.has(file.type) || file.size <= 0)) {
    uploadMessage.value = "请选择有效的 PDF、JPEG 或 PNG 原件，最多二十份。";
    return;
  }
  pendingFiles.value = files.map(file => ({ file, key: crypto.randomUUID() }));
  await uploadRemaining();
}

async function uploadRemaining() {
  if (locked.value || !pendingFiles.value.length) return;
  uploading.value = true;
  uploadMessage.value = "";
  try {
    while (pendingFiles.value.length) {
      const { file, key } = pendingFiles.value[0]!;
      const uploaded = await props.uploadOriginal(file, key);
      if (!alive || props.disabled) return;
      if (typeof uploaded.id !== "string" || !uploaded.id || uploaded.mimeType !== file.type || uploaded.sizeBytes !== file.size ||
        props.aggregate.attachments.some(item => item.fileId === uploaded.id)) throw new Error();
      fileNames[uploaded.id] = typeof uploaded.originalName === "string" && uploaded.originalName ? uploaded.originalName : file.name;
      emit("set-attachments", [...props.aggregate.attachments,
        { fileId: uploaded.id, slotKey: directOriginalSlot, displayOrder: props.aggregate.attachments.length }]);
      pendingFiles.value.shift();
    }
  } catch {
    if (alive && !props.disabled) uploadMessage.value = "原件暂未上传成功，请重试。";
  } finally { uploading.value = false; }
}
function discardPendingFiles() {
  if (locked.value) return;
  pendingFiles.value = [];
  uploadMessage.value = "";
}
function moveAttachment(index: number, step: number) {
  const list = [...props.aggregate.attachments];
  const target = index + step;
  if (locked.value || pendingFiles.value.length || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target]!, list[index]!];
  emit("set-attachments", list.map((item, displayOrder) => ({ ...item, displayOrder })));
}
function removeAttachment(index: number) {
  if (locked.value || pendingFiles.value.length) return;
  emit("set-attachments", props.aggregate.attachments.filter((_, position) => position !== index).map((item, displayOrder) => ({ ...item, displayOrder })));
}
</script>

<style scoped>
.direct-pending {
  display: grid;
  gap: var(--jg-space-md);
  max-width: 60rem;
  margin: 0 auto;
  padding: var(--jg-space-lg);
  color: var(--jg-text-strong);
}
.direct-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: var(--jg-space-md);
}
.direct-fields label, .text-field, .party-side, .originals {
  display: grid;
  gap: var(--jg-space-xs);
}
.inline-actions {
  align-self: end;
}
.original-number {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.originals {
  padding-inline-start: var(--jg-space-lg);
}
.originals li {
  overflow-wrap: anywhere;
}
.originals small {
  margin-inline-start: var(--jg-space-sm);
}
</style>
