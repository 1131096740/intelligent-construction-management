import { createApp } from "vue";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import App from "./app/App.vue";
import { router } from "./routes";

createApp(App).use(router).use(TDesign).mount("#app");
