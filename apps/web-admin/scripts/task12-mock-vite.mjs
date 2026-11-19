// Owned mock-browser transport: no API proxy and no implicit backend fallback.
import { createServer, loadConfigFromFile } from "vite";
const port = Number(process.argv[2]);
if (![54912, 54913, 54914].includes(port)) throw new Error("Unsupported owned test port");
const loaded = await loadConfigFromFile({ command: "serve", mode: "test" });
if (!loaded) throw new Error("Missing existing Vite configuration");
const server = await createServer({ ...loaded.config, configFile: false,
  server: { ...loaded.config.server, host: "127.0.0.1", port, strictPort: true, proxy: {} },
  plugins: [...(loaded.config.plugins ?? []), { name: "task12-reject-unmocked-api", configureServer(instance) {
    instance.middlewares.use((req, res, next) => {
      if (!/^\/api(?:\/|\?|$)/u.test(req.url ?? "")) return next();
      console.error(`TASK12_UNMOCKED_API ${req.method} ${req.url}`);
      res.statusCode = 598; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "测试请求未配置模拟接口" }));
    });
  } }]
});
if (Object.keys(server.config.server.proxy ?? {}).length !== 0) throw new Error("API proxy must be empty");
console.log(`TASK12_TRANSPORT proxy={} origin=http://127.0.0.1:${port}`);
await server.listen();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
