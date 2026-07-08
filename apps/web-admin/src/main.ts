import { createApp } from "vue";
import { createPinia } from "pinia";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import "./app/design-tokens.css";
import App from "./app/App.vue";
import { useAuthStore } from "./auth/auth.store";
import { router } from "./routes";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
useAuthStore().restore();

app.use(router).use(TDesign).mount("#app");
