<template>
  <section class="page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>合作单位档案</h1>
        <p>按名称或统一社会信用代码检索；档案变更进入新版本，不覆盖历史</p>
      </div>
      <t-space class="query-actions">
        <t-input
          v-model="query"
          placeholder="名称 / 统一社会信用代码"
        />
        <t-button @click="loadParties">
          查询
        </t-button>
        <t-button
          v-if="canCreate"
          theme="primary"
          @click="goCreate"
        >
          新建合作单位
        </t-button>
      </t-space>
    </div>

    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="当前可查询合作单位及版本历史；新建档案仅通过受控业务入口提交。"
      class="panel"
    />

    <t-card
      :bordered="true"
      class="panel jg-table-region jg-table-region--standard"
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
      v-if="message"
      :class="['message', tone]"
    >
      {{ message }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatUnknownApiError } from "../../api/error-message";
import {
  getBusinessPartyCreateCapability,
  listBusinessParties
} from "../../api/contract-workbench.api";

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
const message = ref("");
const tone = ref<"danger" | "warning">("danger");
const createActions = ref<string[]>([]);
const canCreate = computed(() => createActions.value.includes("business_party.create"));

function go(id: string) {
  void router.push(`/business-parties/${id}`);
}

function goCreate() {
  void router.push("/business-parties/new");
}

async function loadParties() {
  loading.value = true;
  try {
    parties.value = (await listBusinessParties(query.value.trim() || undefined)) as PartyRow[];
  } catch (error) {
    message.value = formatUnknownApiError(error, "加载合作单位失败");
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function loadCreateCapability() {
  try {
    const capability = await getBusinessPartyCreateCapability();
    createActions.value = capability.availableActions;
  } catch {
    createActions.value = [];
  }
}

onMounted(() => {
  if (route.query.notice === "create-forbidden") {
    message.value = "当前账号没有创建合作单位的服务端授权。";
    tone.value = "warning";
    void router.replace({ path: "/business-parties" });
  }
  void loadParties();
  void loadCreateCapability();
});
</script>

<style scoped>
.page { min-width: 0; color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.query-actions { flex-wrap: wrap; }
.message { font-size: 12px; }
.danger { color: #b51d2a; }
.warning { color: #9a6700; }
@container jg-page (max-width: 620px) { .page-head { display: grid; grid-template-columns: 1fr; } }
</style>
