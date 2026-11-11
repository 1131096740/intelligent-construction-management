import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
type Server = Awaited<ReturnType<typeof createTemplateTestServer>>;

describe("task09 new draft business type authority for manual layout selection", () => {
  let server: Server;
  beforeAll(async () => { server = await createTemplateTestServer({ draftWorkbench: true }); });
  afterAll(async () => { await server.app.close(); });
  it("rejects missing or invalid new-pending type without falling back to the parent or writing rows", async () => {
    const draft = await createTask09Draft(server);
    const before = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
    for (const invalid of [undefined, "generic_contract"]) {
      const response = await saveTask09Draft(server, draft, invalid);
      expect(response.status).toBe(400);
    }
    const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
    expect(after).toEqual(before);
  });
});
