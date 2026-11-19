import { defineConfig } from "@playwright/test";
const apiPort = Number(process.env.JG_PAYMENT_API_PORT);
const webPort = Number(process.env.JG_PAYMENT_WEB_PORT);
if (![apiPort,webPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || apiPort === webPort) throw new Error("Assign independent loopback payment ports");
export default defineConfig({ testDir:"./e2e", testMatch:"registered-payment-http.e2e.ts", timeout:30_000, retries:0, workers:1, outputDir:process.env.JG_PAYMENT_ARTIFACTS, reporter:"list", use:{baseURL:`http://127.0.0.1:${webPort}`,trace:"retain-on-failure"}, projects:[{name:"desktop",use:{browserName:"chromium",viewport:{width:1366,height:768}}},{name:"mobile",use:{browserName:"chromium",viewport:{width:390,height:844},isMobile:true,hasTouch:true}}] });
