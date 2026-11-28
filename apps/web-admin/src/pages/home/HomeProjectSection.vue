<script setup lang="ts">
import type { ProjectOptionReadModel } from "../../api/core-flow-read.api";

defineProps<{
  projects: readonly ProjectOptionReadModel[];
  loading: boolean;
  errorMessage: string;
}>();
const emit = defineEmits<{ open: [projectId: string]; openWorkbench: [] }>();
</script>

<template>
  <section
    class="home-projects"
    aria-labelledby="home-projects-title"
  >
    <header class="home-projects__head">
      <div>
        <h2 id="home-projects-title">
          我的项目
        </h2>
        <p>只列出当前账号有权查看的项目；进入项目经营查看合同、资金与经营账。</p>
      </div>
      <t-button
        variant="outline"
        @click="emit('openWorkbench')"
      >
        项目经营
      </t-button>
    </header>

    <p
      v-if="errorMessage"
      class="home-projects__hint home-projects__hint--muted"
    >
      {{ errorMessage }}
    </p>

    <p
      v-else-if="loading"
      class="home-projects__hint"
    >
      正在读取项目…
    </p>

    <p
      v-else-if="!projects.length"
      class="home-projects__hint"
    >
      当前账号暂无可查看项目；如有疑问请联系综合部核对项目任职。
    </p>

    <ul
      v-else
      class="home-projects__grid"
    >
      <li
        v-for="project in projects"
        :key="project.id"
      >
        <t-button
          variant="outline"
          class="home-projects__card"
          @click="emit('open', project.id)"
        >
          <strong>{{ project.name }}</strong>
          <small>{{ project.code }}</small>
        </t-button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.home-projects { display: grid; gap: var(--jg-space-md); }
.home-projects__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--jg-space-md); }
.home-projects__head h2 { margin: 0; font-size: var(--jg-font-size-section-title); }
.home-projects__head p { margin: var(--jg-space-xs) 0 0; color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.home-projects__hint { margin: 0; padding: var(--jg-space-lg); color: var(--jg-color-text-secondary); background: var(--jg-color-bg-surface); border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-panel); }
.home-projects__hint--muted { color: var(--jg-color-text-tertiary); }
.home-projects__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--jg-space-md); margin: 0; padding: 0; list-style: none; }
.home-projects__card { width: 100%; height: 100%; padding: var(--jg-space-lg); text-align: left; white-space: normal; background: var(--jg-color-bg-surface); border-color: var(--jg-color-border); border-radius: var(--jg-radius-panel); }
.home-projects__card :deep(.t-button__text) { display: grid; gap: var(--jg-space-xs); width: 100%; }
.home-projects__card strong { color: var(--jg-color-text-primary); font-size: var(--jg-font-size-body); }
.home-projects__card small { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); font-weight: var(--jg-font-weight-regular); }
.home-projects__card:hover { border-color: var(--jg-color-brand); }
@media (max-width: 720px) {
  .home-projects__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
