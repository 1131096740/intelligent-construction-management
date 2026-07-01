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
          value="/contract-templates"
          @click="go('/contract-templates')"
        >
          模板中心
        </t-menu-item>
        <t-menu-item
          value="/business-parties"
          @click="go('/business-parties')"
        >
          合作单位档案
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
          value="/delegations"
          @click="go('/delegations')"
        >
          委托台账
        </t-menu-item>
        <t-menu-item
          value="/audit"
          @click="go('/audit')"
        >
          审计日志
        </t-menu-item>
        <t-menu-item
          value="/settings"
          @click="go('/settings')"
        >
          设置
        </t-menu-item>
      </t-menu>
    </t-aside>

    <t-layout class="main-shell">
      <t-header class="header">
        <span>合同付款闭环管理</span>
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
  flex: 0 0 208px;
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
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
  white-space: nowrap;
}

.header-user {
  margin-left: auto;
}

.content {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: calc(100vh - 48px);
  padding: 24px;
  overflow-x: auto;
  background: #f4f6f9;
}

.main-shell {
  min-width: 0;
}

@media (max-width: 900px) {
  .admin-shell {
    display: block;
  }

  .aside {
    width: 100% !important;
    border-right: 0;
    border-bottom: 1px solid #dce1e8;
  }

  .brand {
    height: 44px;
    padding: 0 12px;
  }

  .menu {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 4px;
    padding: 8px 6px;
  }

  .header {
    min-height: 44px;
    height: auto;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
  }

  .header-user {
    margin-left: 0;
  }

  .content {
    min-height: calc(100vh - 44px);
    padding: 12px;
  }
}
</style>
