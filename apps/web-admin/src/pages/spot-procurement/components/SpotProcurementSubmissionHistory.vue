<script setup lang="ts">
import type { BusinessEntryFieldDefinition } from "@jiangkong/shared-domain";
import type { SpotProcurementDetailReadModel } from "../../../api/spot-procurement.api";
import { formatBusinessEntryReadonlyValue } from "../../../lib/business-entry-adapters";

type Snapshot = SpotProcurementDetailReadModel["entrySnapshots"][number];

defineProps<{ snapshots: Snapshot[] }>();

function displayValue(field: BusinessEntryFieldDefinition, values: Record<string, unknown>) {
  return formatBusinessEntryReadonlyValue(field, values[field.key]);
}
</script>

<template>
  <section class="spot-entry-history" aria-label="采购申请提交记录">
    <h3>提交冻结记录</h3>
    <t-alert theme="info" message="以下内容来自提交时冻结的填写定义与业务值，不随当前规则变化。" />
    <p v-if="!snapshots.length">暂无提交记录；保存草稿不等于提交审批。</p>
    <article
      v-for="snapshot in snapshots"
      :key="`${snapshot.sceneKey}-${snapshot.versionNo}-${snapshot.lineNumber ?? 'header'}-${snapshot.revision}`"
    >
      <h4>V{{ snapshot.versionNo }} {{ snapshot.lineNumber === null ? "申请表头" : `材料明细第 ${snapshot.lineNumber} 行` }}</h4>
      <p>冻结时间：{{ new Date(snapshot.frozenAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
      <dl>
        <div v-for="field in snapshot.definitionSnapshot.fields" :key="field.key">
          <dt>{{ field.label }}</dt><dd>{{ displayValue(field, snapshot.valuesSnapshot) }}</dd>
        </div>
      </dl>
    </article>
  </section>
</template>

<style scoped>
.spot-entry-history { display: grid; gap: var(--jg-space-md); min-width: 0; }
.spot-entry-history h3, .spot-entry-history h4, .spot-entry-history p { margin: 0; }
.spot-entry-history article { padding: var(--jg-space-md); border: 1px solid var(--jg-color-border); border-radius: var(--jg-radius-md); }
.spot-entry-history dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-md); }
.spot-entry-history dl div { min-width: 0; overflow-wrap: anywhere; }
.spot-entry-history dt { color: var(--jg-color-text-tertiary); }
.spot-entry-history dd { margin: var(--jg-space-xs) 0 0; }
@media (max-width: 767px) { .spot-entry-history dl { grid-template-columns: minmax(0, 1fr); } }
</style>
