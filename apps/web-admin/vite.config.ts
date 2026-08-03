import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    include: ["@jiangkong/shared-domain"]
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared-domain/]
    }
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"]
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
