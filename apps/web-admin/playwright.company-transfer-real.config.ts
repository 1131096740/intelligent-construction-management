import {defineConfig,devices} from "@playwright/test";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
const api=process.env.COMPANY_TRANSFER_API??"";
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(api)||!process.env.COMPANY_TRANSFER_FIXTURE)throw new Error("公司互转浏览器仅接受本机合成验收实例");
export default defineConfig({testDir:"./e2e",testMatch:"company-transfer-real.e2e.ts",workers:1,retries:0,timeout:90000,reporter:"list",outputDir:join(tmpdir(),`company-transfer-browser-${randomUUID()}`),use:{baseURL:"http://127.0.0.1:5193",trace:"retain-on-failure",screenshot:"only-on-failure"},webServer:{command:"pnpm dev --host 127.0.0.1 --port 5193 --strictPort",url:"http://127.0.0.1:5193",reuseExistingServer:false,env:{VITE_API_PROXY_TARGET:api}},projects:[{name:"desktop",use:{...devices["Desktop Chrome"],viewport:{width:1366,height:900}}},{name:"mobile",use:{...devices["Pixel 7"]}}]});
