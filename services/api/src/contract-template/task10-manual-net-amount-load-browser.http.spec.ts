import { task10HttpRepository } from "./task10-http-repository.test-support";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 manual four-decimal net amount real body filling UI", () => {
  it("loads a known saved manual net amount and preserves it when only the contract name is saved", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-manual-net-amount-load-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-workbench/contract-workbench.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-manual-net-amount-load-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "other")).status).toBe(200);
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json() as { version: { draftRevision: number; draftData: Record<string, unknown> }; bills: Array<{ billKey: string; revision: number }> };
      const basics = { relationship: "upward", businessType: "other", amountBasis: "tax_exclusive", settlementText: "按双方实际确认结算", invoiceStatus: "none" };
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData, contractBasics: basics }, clauses: [], pricingNature: "fixed_total", amountSource: "manual", manualAmountYuan: "1.5340",
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map(bill => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const factResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(factResponse.status).toBe(200);
      const facts = await factResponse.json();
      expect(facts.version).toMatchObject({ numericProtocolVersion: 2, pricingNature: "fixed_total", amountSource: "manual", amountYuan: "1.5340", invoiceType: null, defaultTaxRatePercent: null });
      expect(facts.version.layoutTemplateVersionId ?? null).toBeNull();
      expect(facts.version.draftData.contractBasics).toMatchObject(basics);
      expect(facts.bills.every((bill: { rows: unknown[] }) => bill.rows.length === 0)).toBe(true);
      await writeFile(join(directory, "public-known-manual-net-facts.json"), JSON.stringify({ version: { numericProtocolVersion: facts.version.numericProtocolVersion, pricingNature: facts.version.pricingNature, amountSource: facts.version.amountSource, amountYuan: facts.version.amountYuan, draftRevision: facts.version.draftRevision, invoiceType: facts.version.invoiceType, defaultTaxRatePercent: facts.version.defaultTaxRatePercent, layoutTemplateVersionId: facts.version.layoutTemplateVersionId ?? null }, contractBasics: facts.version.draftData.contractBasics }, null, 2));
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const args = ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-manual-net-amount-load.config.ts", "--project=desktop", "--max-failures=1"];
      const result = await promisify(execFile)("pnpm", args, {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: { id: draft.contract.id }, version: { id: draft.version.id } }, expectedRevision: facts.version.draftRevision, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10手动净额真实桌面证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10手动净额浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
