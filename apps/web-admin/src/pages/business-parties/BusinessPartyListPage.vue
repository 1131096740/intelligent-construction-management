<template>
  <section class="page jg-responsive-ledger">
    <BusinessPageHeader
      title="合作单位档案"
      description="按名称或统一社会信用代码检索；档案变更进入新版本，不覆盖历史"
    >
      <template #actions>
        <t-space>
          <t-button
            v-if="definition?.key"
            theme="primary"
            @click="goCreate"
          >
            新建合作单位
          </t-button>
          <t-input
            v-model="query"
            placeholder="名称 / 统一社会信用代码"
          />
          <t-button @click="loadParties">
            查询
          </t-button>
        </t-space>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="message"
      :state="tone === 'danger' ? 'permission' : 'success'"
      title="合作单位档案"
      :description="message"
    />

    <BusinessFeedback
      state="info"
      title="档案读取"
      description="所有已登录用户可查询合作单位及版本历史；仅服务端确认具备公司级合同岗位的用户可以新建档案。"
    />

    <t-card
      :bordered="true"
      class="jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="parties"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无合作单位"
      >
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="go(row.id)"
          >
            查看版本
          </t-link>
        </template>
      </t-table>
    </t-card>

    <p
      v-if="loadError"
      class="message danger"
    >
      {{ loadError }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import {
  fetchBusinessEntryDefinition,
  issueBusinessEntryCreateTarget
} from "../../api/business-entry.api";
import { listBusinessParties } from "../../api/contract-workbench.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import {
  createBusinessPartyIdempotencyKey,
  fingerprintBusinessPartyValues
} from "./business-party-create.config";

interface PartyRow {
  id: string;
  name?: string;
  unifiedSocialCreditCode?: string | null;
  createdAt?: string;
}

const router = useRouter();
const route = useRoute();
const columns = [
  { colKey: "name", title: "名称", minWidth: 180 },
  { colKey: "unifiedSocialCreditCode", title: "统一社会信用代码", minWidth: 180 },
  { colKey: "createdAt", title: "创建时间", width: 180 },
  { colKey: "operation", title: "操作", width: 120, fixed: "right" }
];
const query = ref("");
const parties = ref<PartyRow[]>([]);
const loading = ref(false);
const loadError = ref("");
const message = ref("");
const tone = ref<"success" | "danger">("success");
const createCapability = ref<"checking" | "allowed" | "denied">("checking");
const definition = ref<BusinessEntrySceneDefinition | null>(null);

function go(id: string) {
  void router.push(`/business-parties/${id}`);
}

function goCreate() {
  void router.push("/合作单位档案/新建");
}

async function loadParties() {
  loading.value = true;
  loadError.value = "";
  try {
    parties.value = (await listBusinessParties(query.value.trim() || undefined)) as PartyRow[];
  } catch {
    parties.value = [];
    loadError.value = "加载合作单位失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}

async function loadCreateCapability() {
  const values = { type: "organization" as const, name: "", attachments: [] as const };
  const fingerprint = await fingerprintBusinessPartyValues(values);
  const probe = await issueBusinessEntryCreateTarget("business_party", { scope: "global" }, {
    entityType: "business_party",
    idempotencyKey: createBusinessPartyIdempotencyKey(),
    fingerprint,
    definitionKey: "business_party",
    definitionVersion: 1
  });
  definition.value = await fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    { entityType: "business_party", createTarget: probe.createTarget },
    "edit"
  );
  createCapability.value = "allowed";
}

onMounted(() => {
  if (route.query.notice === "permission") {
    message.value = "当前岗位无权新建合作单位";
    tone.value = "danger";
    void router.replace({ query: {} });
  }
  void loadParties();
  void loadCreateCapability().catch(() => {
    createCapability.value = "denied";
  });
});
</script>

<style scoped>
.page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
}

.page :deep(.t-space) {
  flex-wrap: wrap;
}

.message {
  margin: 0;
  font-size: var(--jg-font-size-meta);
}

.danger {
  color: var(--jg-color-danger);
}
</style>
