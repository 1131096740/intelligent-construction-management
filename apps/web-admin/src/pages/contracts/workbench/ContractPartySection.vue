<template>
  <div class="workbench-section">
    <h2 class="section-title">
      合作单位与角色
    </h2>
    <p class="section-hint">
      从一阶段合作单位档案中选择，或录入临时快照。资质附件引用与有效期用于归档校验。
    </p>

    <div class="party-list">
      <div
        v-for="(party, index) in parties"
        :key="`${party.roleKey}-${party.displayOrder}-${index}`"
        class="party-row"
      >
        <div class="party-head">
          <strong>{{ roleLabel(party.roleKey) }}</strong>
          <t-tag
            size="small"
            variant="light"
            :theme="party.businessPartyVersionId ? 'primary' : 'default'"
          >
            {{ party.businessPartyVersionId ? "档案引用" : "临时快照" }}
          </t-tag>
        </div>
        <div class="party-fields">
          <label
            v-for="field in snapshotFields"
            :key="field.key"
            class="field"
          >
            <span class="field-label">{{ field.label }}</span>
            <t-input
              :value="partyValue(party, field.key)"
              disabled
              :placeholder="field.placeholder"
            />
          </label>
        </div>
        <ul
          v-if="partyAttachments(party).length"
          class="snapshot-attachments"
        >
          <li
            v-for="attachment in partyAttachments(party)"
            :key="`${attachment.fileId}-${attachment.category}`"
          >
            {{ attachmentLabel(attachment.category) }}：{{ attachment.name }}
            <span v-if="attachment.validUntil">（有效期至 {{ attachment.validUntil }}）</span>
          </li>
        </ul>
      </div>

      <p
        v-if="parties.length === 0"
        class="empty"
      >
        暂无合作单位，请在加载工作台后添加。
      </p>
    </div>

    <form
      class="party-form"
      @submit.prevent="submitInlineParty"
    >
      <div class="form-head">
        <strong>录入合作单位快照</strong>
        <span>{{ message }}</span>
      </div>
      <p class="section-hint">
        加入后只进入本合同聚合草稿，随右上角统一保存；不会自动进入合作单位档案。
      </p>

      <div class="party-fields">
        <label class="field">
          <span class="field-label">合同角色</span>
          <t-select
            v-model="form.roleKey"
            :options="roleOptions"
            :disabled="disabled || busy"
          />
        </label>
        <label
          v-for="field in snapshotFields"
          :key="field.key"
          class="field"
        >
          <span class="field-label">{{ field.label }}</span>
          <t-input
            v-model="form[field.key]"
            :data-field-key="field.key === 'name' ? 'counterparty' : field.key"
            :disabled="disabled || busy"
            :placeholder="field.placeholder"
          />
        </label>
      </div>

      <div class="attachments">
        <div class="attachment-head">
          <strong>资质附件</strong>
        </div>
        <div
          v-for="card in attachmentCards"
          :key="card.title"
          class="attachment-card"
        >
          <div class="attachment-card-head">
            <strong>{{ card.title }}</strong>
            <span>{{ card.description }}</span>
          </div>
          <div
            v-for="upload in card.uploads"
            :key="upload.key"
            class="attachment-upload"
          >
            <div class="attachment-file">
              <strong>{{ upload.label }}</strong>
              <span>{{ upload.fileId ? `已上传：${upload.name}` : "未上传" }}</span>
            </div>
            <t-input
              v-if="upload.hasValidUntil"
              v-model="upload.validUntil"
              :disabled="disabled || busy"
              placeholder="有效期，如 2026-12-31"
            />
            <span
              v-else
              class="attachment-no-expiry"
            >
              无需有效期
            </span>
            <input
              type="file"
              :disabled="disabled || busy"
              @change="(event) => uploadAttachment(upload, event)"
            >
          </div>
        </div>
      </div>
      <p class="section-hint">
        开户行/开户账号与实际收款开户行/实际收款账号按合同约定选填一组；若使用一般户收款，请填写实际收款信息，便于后续财务付款。
      </p>

      <div class="form-actions">
        <t-button
          type="submit"
          theme="primary"
          :loading="busy"
          :disabled="disabled || busy || !form.name.trim()"
        >
          加入合同草稿
        </t-button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import type { ContractDraftPartyModel } from "../../../api/contract-workbench.api";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";

const props = defineProps<{
  parties: ContractDraftPartyModel[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "update:parties", parties: ContractDraftPartyModel[]): void;
  (event: "edited"): void;
}>();

const ROLE_LABELS: Record<string, string> = {
  party_a: "甲方",
  party_b: "乙方",
  party_c: "丙方",
  guarantor: "担保单位",
  consortium_member: "联合体成员",
  other: "其他"
};

const roleOptions = Object.entries(ROLE_LABELS)
  .filter(([value]) => value !== "party_a")
  .map(([value, label]) => ({ label, value }));
const ATTACHMENT_LABELS: Record<string, string> = {
  business_license: "营业执照",
  bank_account: "开户许可证",
  legal_id: "法人身份证",
  authorization: "授权委托书",
  qualification: "资质文件",
  other: "其他"
};
const DEFAULT_ATTACHMENT_NAMES: Record<string, string> = {
  business_license: "营业执照",
  bank_account: "开户许可证",
  legal_id_front: "法人身份证人像面",
  legal_id_back: "法人身份证国徽面"
};
const snapshotFields = [
  { key: "name", label: "公司名称", placeholder: "请输入公司名称" },
  { key: "unifiedSocialCreditCode", label: "纳税人识别号", placeholder: "统一社会信用代码" },
  { key: "address", label: "地址", placeholder: "注册地址/通讯地址" },
  { key: "contactPhone", label: "电话", placeholder: "联系电话" },
  { key: "legalRepresentative", label: "法人姓名", placeholder: "法定代表人姓名" },
  { key: "legalRepresentativeIdNo", label: "法人身份证号", placeholder: "身份证号码" },
  { key: "authorizedAgentName", label: "委托代理人", placeholder: "代理人姓名" },
  { key: "authorizedAgentIdNo", label: "代理人身份证号", placeholder: "身份证号码" },
  { key: "openingBank", label: "开户行", placeholder: "开户银行" },
  { key: "bankAccount", label: "开户账号", placeholder: "银行账号" },
  { key: "paymentBank", label: "实际收款开户行", placeholder: "使用一般户收款时填写" },
  { key: "paymentAccount", label: "实际收款账号", placeholder: "使用一般户收款时填写" }
] as const;

type SnapshotFieldKey = (typeof snapshotFields)[number]["key"];

interface AttachmentForm {
  key: string;
  label: string;
  category: "business_license" | "bank_account" | "legal_id" | "authorization" | "qualification" | "other";
  fileId: string;
  name: string;
  validUntil: string;
  hasValidUntil: boolean;
}

interface AttachmentCard {
  title: string;
  description: string;
  uploads: AttachmentForm[];
}

const form = reactive<Record<SnapshotFieldKey | "roleKey", string>>({
  roleKey: "party_b",
  name: "",
  unifiedSocialCreditCode: "",
  address: "",
  contactPhone: "",
  legalRepresentative: "",
  legalRepresentativeIdNo: "",
  authorizedAgentName: "",
  authorizedAgentIdNo: "",
  openingBank: "",
  bankAccount: "",
  paymentBank: "",
  paymentAccount: ""
});
const attachmentCards = reactive<AttachmentCard[]>([
  {
    title: "营业执照上传",
    description: "上传合作单位营业执照。",
    uploads: [
      {
        key: "business_license",
        label: "营业执照",
        category: "business_license",
        fileId: "",
        name: "营业执照",
        validUntil: "",
        hasValidUntil: true
      }
    ]
  },
  {
    title: "开户许可证上传",
    description: "上传开户许可证或基本户证明，无需填写有效期。",
    uploads: [
      {
        key: "bank_account",
        label: "开户许可证",
        category: "bank_account",
        fileId: "",
        name: "开户许可证",
        validUntil: "",
        hasValidUntil: false
      }
    ]
  },
  {
    title: "法人身份证人像面/国徽面上传",
    description: "分别上传法人身份证人像面和国徽面；生成附件页时人像面在上、国徽面在下，两面共用同一个有效期。",
    uploads: [
      {
        key: "legal_id_front",
        label: "身份证人像面",
        category: "legal_id",
        fileId: "",
        name: "法人身份证人像面",
        validUntil: "",
        hasValidUntil: true
      },
      {
        key: "legal_id_back",
        label: "身份证国徽面",
        category: "legal_id",
        fileId: "",
        name: "法人身份证国徽面",
        validUntil: "",
        hasValidUntil: false
      }
    ]
  }
]);
const busy = ref(false);
const message = ref("");

function roleLabel(roleKey: string): string {
  return ROLE_LABELS[roleKey] ?? "其他单位";
}

function partyValue(
  party: ContractDraftPartyModel,
  field: string
): string {
  const value = party.snapshot[field];
  return typeof value === "string" ? value : "";
}

function partyAttachments(party: ContractDraftPartyModel) {
  const value = party.snapshot["attachments"];
  return Array.isArray(value)
    ? (value as Array<{
        category: string;
        fileId: string;
        name: string;
        validUntil?: string;
      }>)
    : [];
}

function attachmentLabel(category: string) {
  return ATTACHMENT_LABELS[category] ?? "其他资料";
}

function flatAttachments() {
  return attachmentCards.flatMap((card) => card.uploads);
}

function attachmentValidUntil(attachment: AttachmentForm) {
  if (attachment.key === "legal_id_back") {
    return flatAttachments().find((item) => item.key === "legal_id_front")?.validUntil ?? "";
  }
  return attachment.validUntil;
}

async function uploadAttachment(attachment: AttachmentForm, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, `${attachment.label} - ${file.name}`);
    attachment.fileId = uploaded.id;
    attachment.name = `${attachment.label} - ${file.name}`;
    message.value = "附件已上传";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "附件上传失败";
  } finally {
    busy.value = false;
    input.value = "";
  }
}

function buildSnapshot() {
  const snapshot: Record<string, unknown> = {};
  for (const field of snapshotFields) {
    const value = form[field.key].trim();
    if (value) snapshot[field.key] = value;
  }
  snapshot.attachments = flatAttachments()
    .filter((attachment) => attachment.fileId && attachment.name.trim())
    .map((attachment) => ({
      category: attachment.category,
      fileId: attachment.fileId,
      name: attachment.name.trim(),
      ...(attachmentValidUntil(attachment).trim()
        ? { validUntil: attachmentValidUntil(attachment).trim() }
        : {})
    }));
  return snapshot;
}

function resetForm() {
  for (const field of snapshotFields) {
    form[field.key] = "";
  }
  form.roleKey = "party_b";
  for (const attachment of flatAttachments()) {
    attachment.fileId = "";
    attachment.name = DEFAULT_ATTACHMENT_NAMES[attachment.key] ?? attachment.label;
    attachment.validUntil = "";
  }
}

function submitInlineParty() {
  if (props.disabled || busy.value || !form.name.trim()) return;
  message.value = "";
  const displayOrder =
    props.parties.reduce(
      (highest, party) => Math.max(highest, party.displayOrder),
      -1
    ) + 1;
  emit(
    "update:parties",
    [
      ...props.parties.map(cloneParty),
      {
        roleKey: form.roleKey,
        displayOrder,
        snapshot: buildSnapshot()
      }
    ]
  );
  emit("edited");
  resetForm();
  message.value = "已加入合同草稿，等待右上角统一保存";
}

function cloneParty(party: ContractDraftPartyModel): ContractDraftPartyModel {
  return {
    roleKey: party.roleKey,
    displayOrder: party.displayOrder,
    ...(party.businessPartyVersionId
      ? { businessPartyVersionId: party.businessPartyVersionId }
      : {}),
    snapshot: {
      ...party.snapshot,
      ...(Array.isArray(party.snapshot["attachments"])
        ? {
            attachments: party.snapshot["attachments"].map((attachment) =>
              attachment !== null &&
              typeof attachment === "object" &&
              !Array.isArray(attachment)
                ? { ...attachment }
                : attachment
            )
          }
        : {})
    }
  };
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
  container-name: contract-party;
  container-type: inline-size;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #151922;
}

.section-hint {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.party-list {
  display: grid;
  gap: 16px;
}

.party-row {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.party-form {
  display: grid;
  gap: 16px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.form-head,
.attachment-head,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-head span {
  color: #0052cc;
  font-size: 12px;
}

.attachments {
  display: grid;
  gap: 12px;
}

.attachment-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #f8fafc;
}

.attachment-card-head {
  display: grid;
  gap: 4px;
}

.attachment-card-head span,
.attachment-file span {
  color: #767f8d;
  font-size: 12px;
}

.attachment-upload {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(140px, 180px) minmax(180px, 1fr);
  gap: 10px;
  align-items: center;
}

.attachment-file {
  display: grid;
  gap: 4px;
}

.attachment-no-expiry {
  color: #767f8d;
  font-size: 12px;
}

.snapshot-attachments {
  margin: 0;
  padding-left: 18px;
  color: #424955;
  font-size: 12px;
}

.party-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.party-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.empty {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

@container contract-party (max-width: 620px) {
  .attachment-upload {
    grid-template-columns: 1fr;
  }

  .form-head,
  .attachment-head,
  .form-actions {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
