<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { PrimaryTableCol, UploadFile } from "tdesign-vue-next";
import {
  confirmProjectAffiliateCompanyContract,
  fetchProjectAffiliateCompanyContracts,
  recordProjectAffiliateCompanyContract,
  uploadPrivateFile,
  type ProjectAffiliateCompanyContractReadModel,
  type ProjectAffiliateCompanyContractsReadModel
} from "../../../api/core-flow-read.api";
import {
  fetchActiveCompanyEntities,
  type CompanyEntityModel
} from "../../../api/company-entity.api";
import SensitiveActionDialog from "../../../components/SensitiveActionDialog.vue";

const props = defineProps<{ projectId: string }>();

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
const confirmTarget = ref<ProjectAffiliateCompanyContractReadModel | null>(null);
const confirmVisible = ref(false);
const confirmBusy = ref(false);
const confirmError = ref("");

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
watch(
  () => props.projectId,
  () => {
    data.value = null;
    companies.value = [];
    void load();
  }
);

async function load() {
  if (!props.projectId) return;
  loading.value = true;
  loadError.value = "";
  try {
    const contracts = await fetchProjectAffiliateCompanyContracts(props.projectId);
    data.value = contracts;
    companies.value = contracts.availableActions.includes(
      "record_affiliate_company_contract"
    )
      ? await fetchActiveCompanyEntities()
      : [];
  } catch (error) {
    loadError.value = errorMessage(error, "挂靠企业与我方线下合同读取失败");
  } finally {
    loading.value = false;
  }
}

function openRecord() {
  form.value = createForm();
  signedFiles.value = [];
  recordError.value = "";
  recordVisible.value = true;
}

async function submitRecord() {
  recordBusy.value = true;
  recordError.value = "";
  try {
    const raw = signedFiles.value[0]?.raw;
    if (!(raw instanceof File)) {
      throw new Error("请上传已由双方线下签署的正式合同文件");
    }
    const uploaded = await uploadPrivateFile(raw, raw.name);
    await recordProjectAffiliateCompanyContract(props.projectId, {
      contractReference: required(form.value.contractReference, "线下合同编号"),
      contractName: required(form.value.contractName, "线下合同名称"),
      signedAt: required(form.value.signedAt, "签订日期"),
      rightsObligationsSummary: required(
        form.value.rightsObligationsSummary,
        "双方权利义务摘要"
      ),
      companyEntityId: required(form.value.companyEntityId, "我方签约主体"),
      fileId: uploaded.id,
      idempotencyKey: crypto.randomUUID()
    });
    recordVisible.value = false;
    notice.value =
      "已签线下合同已登记并冻结双方主体与文件摘要；未创建我方审批、用章或业主回款。";
    await load();
  } catch (error) {
    recordError.value = errorMessage(error, "线下合同登记失败");
  } finally {
    recordBusy.value = false;
  }
}

function openConfirm(contract: ProjectAffiliateCompanyContractReadModel) {
  confirmTarget.value = contract;
  confirmError.value = "";
  confirmVisible.value = true;
}

async function submitConfirm(values: { password: string }) {
  if (!confirmTarget.value) return;
  confirmBusy.value = true;
  confirmError.value = "";
  try {
    await confirmProjectAffiliateCompanyContract(
      props.projectId,
      confirmTarget.value.id,
      {
        confirmationPassword: required(values.password, "当前登录密码"),
        confirmationActionId: crypto.randomUUID()
      }
    );
    confirmVisible.value = false;
    confirmTarget.value = null;
    notice.value =
      "合同主管已确认并冻结当前手写签名版本；该确认不是我方合同审批。";
    await load();
  } catch (error) {
    confirmError.value = errorMessage(error, "线下合同确认失败");
  } finally {
    confirmBusy.value = false;
  }
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

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`请填写${label}`);
  return normalized;
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
        v-if="data?.availableActions.includes('record_affiliate_company_contract')"
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
            v-if="row.availableActions.includes('confirm')"
            theme="primary"
            @click="openConfirm(row)"
          >
            确认
          </t-link>
        </template>
      </t-table>
    </t-loading>

    <t-drawer
      v-model:visible="recordVisible"
      header="登记挂靠企业与我方已签线下合同"
      size="min(680px, 100vw)"
      :close-on-overlay-click="false"
    >
      <div class="affiliate-company-contract__form">
        <t-alert
          theme="warning"
          message="这里只登记双方已经线下签完的正式文件，不发起我方审批、用章、结算或付款。"
        />
        <t-input
          v-model="form.contractReference"
          label="线下合同编号"
        />
        <t-input
          v-model="form.contractName"
          label="线下合同名称"
        />
        <t-date-picker
          v-model="form.signedAt"
          label="签订日期"
          value-type="YYYY-MM-DD"
        />
        <t-select
          v-model="form.companyEntityId"
          label="我方签约主体"
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
        />
        <t-upload
          v-model="signedFiles"
          theme="file"
          :auto-upload="false"
          :multiple="false"
          :max="1"
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
          @click="recordVisible = false"
        >
          取消
        </t-button>
        <t-button
          theme="primary"
          :loading="recordBusy"
          @click="submitRecord"
        >
          登记并冻结文件
        </t-button>
      </template>
    </t-drawer>

    <SensitiveActionDialog
      v-model="confirmVisible"
      title="确认挂靠企业与我方线下合同"
      description="确认后合同正文、双方主体快照和文件摘要均不可覆盖或删除；此动作不是我方合同审批。"
      confirm-text="确认并冻结签名"
      :require-password="true"
      :loading="confirmBusy"
      :error="confirmError"
      @confirm="submitConfirm"
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
