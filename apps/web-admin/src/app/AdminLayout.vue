<template>
  <t-layout class="admin-shell">
    <t-aside
      class="aside"
      width="208px"
    >
      <div class="brand">
        建工智管
      </div>
      <t-menu
        class="menu"
        theme="light"
        :value="activePath"
      >
        <t-menu-item
          value="/contracts"
          @click="go('/contracts')"
        >
          合同台账
        </t-menu-item>
        <t-menu-item
          value="/settlements"
          @click="go('/settlements')"
        >
          结算管理
        </t-menu-item>
        <t-menu-item
          value="/payments"
          @click="go('/payments')"
        >
          付款管理
        </t-menu-item>
        <t-menu-item
          value="/archives"
          @click="go('/archives')"
        >
          资料库
        </t-menu-item>
        <t-menu-item
          value="/audit"
          @click="go('/audit')"
        >
          审计日志
        </t-menu-item>
      </t-menu>
    </t-aside>

    <t-layout>
      <t-header class="header">
        <span>审批与合同付款闭环 MVP</span>
        <span class="header-user">建设企业 · 合同部主管</span>
      </t-header>
      <t-content class="content">
        <router-view />
      </t-content>
    </t-layout>
  </t-layout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const activePath = computed(() => route.path);

function go(path: string) {
  void router.push(path);
}
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  color: #151922;
}

.aside {
  background: #f9fafc;
  border-right: 1px solid #dce1e8;
}

.brand {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #dce1e8;
  font-size: 17px;
  font-weight: 700;
}

.menu {
  padding: 14px 8px;
  background: transparent;
}

.header {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
}

.header-user {
  margin-left: auto;
}

.content {
  min-height: calc(100vh - 48px);
  padding: 24px;
  background: #f4f6f9;
}
</style>
