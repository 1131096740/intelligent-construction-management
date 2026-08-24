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
          v-if="canCreate && definition && definition.key"
          theme="primary"
          @click="goCreate"
        >
          新建合作单位
        </t-button>
      </t-space>
    </div>

    <t-alert
      theme="info"
      title="合作单位档案"
      message="当前可查询合作单位及版本历史；新建入口仅在服务端确认当前岗位能力后显示。"
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
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchBusinessEntryCreateCapability,
} from "../../api/business-entry.api";
import { listBusinessParties } from "../../api/contract-workbench.api";

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
const tone = ref<"danger">("danger");
const canCreate = ref(false);
const definition = ref<{ key: string } | null>(null);

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
    message.value = error instanceof Error ? error.message : "加载合作单位失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function loadCreateCapability() {
  const probeDefinition = await fetchBusinessEntryCreateCapability(
    "business_party",
    { scope: "global" },
    "edit"
  );
  const definitionKey = probeDefinition.key;
  if (!definitionKey) throw new Error("业务字段定义无效");
  definition.value = probeDefinition;
  canCreate.value = true;
}

onMounted(() => {
  if (route.query.notice === "no-create-permission") {
    message.value = "当前岗位无权创建合作单位。";
    tone.value = "danger";
    void router.replace({ path: route.path, query: {} });
  }
  void loadParties();
  void loadCreateCapability().catch(() => {
    canCreate.value = false;
  });
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
@container jg-page (max-width: 620px) { .page-head { display: grid; grid-template-columns: 1fr; } }
</style>
