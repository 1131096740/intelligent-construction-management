import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectScope, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import AffiliateCompanyContractPanel from "./AffiliateCompanyContractPanel.vue";

const affiliateContractRuntime = vi.hoisted(() => ({
  confirm: vi.fn(),
  fetchCompanies: vi.fn(),
  fetchContracts: vi.fn(),
  record: vi.fn(),
  upload: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("../../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../../api/core-flow-read.api")
  >();
  return {
    ...original,
    confirmProjectAffiliateCompanyContract: affiliateContractRuntime.confirm,
    fetchProjectAffiliateCompanyContracts:
      affiliateContractRuntime.fetchContracts,
    recordProjectAffiliateCompanyContract: affiliateContractRuntime.record,
    uploadPrivateFile: affiliateContractRuntime.upload
  };
});

vi.mock("../../../api/company-entity.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../../api/company-entity.api")
  >();
  return {
    ...original,
    fetchActiveCompanyEntities: affiliateContractRuntime.fetchCompanies
  };
});

const source = readFileSync(
  resolve(__dirname, "AffiliateCompanyContractPanel.vue"),
  "utf8"
);
const pageActionRegistry = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../docs/product/manifests/web-page-actions.registry.json"
    ),
    "utf8"
  )
) as {
  actions: Array<{
    id: string;
    trigger: {
      element: string;
      event: string;
      handler: string;
    };
    capability: {
      kind: string;
      source: string;
      key: string;
    };
  }>;
};

type MutableValue<T> = { value: T };
type AffiliateContractReadModel = {
  id: string;
  projectId: string;
  status: "pending_confirm" | "confirmed";
  availableActions: Array<"confirm">;
};
type AffiliateContractsReadModel = {
  availableActions: Array<"record_affiliate_company_contract">;
  contracts: AffiliateContractReadModel[];
};
type PanelBindings = {
  cancelConfirm: () => void;
  confirmBusy: MutableValue<boolean>;
  confirmError: MutableValue<string>;
  confirmTarget: MutableValue<AffiliateContractReadModel | null>;
  confirmVisible: MutableValue<boolean>;
  data: MutableValue<AffiliateContractsReadModel | null>;
  form: MutableValue<{
    contractReference: string;
    contractName: string;
    signedAt: string;
    rightsObligationsSummary: string;
    companyEntityId: string;
  }>;
  load: () => Promise<void>;
  loading: MutableValue<boolean>;
  notice: MutableValue<string>;
  openConfirm: (contract: AffiliateContractReadModel) => void;
  openRecord: () => void;
  recordBusy: MutableValue<boolean>;
  recordError: MutableValue<string>;
  recordVisible: MutableValue<boolean>;
  signedFiles: MutableValue<Array<{ raw?: File }>>;
  submitConfirm: (values: { password: string }) => Promise<unknown> | undefined;
  submitRecord: () => Promise<void>;
};

function contractReadModel(
  projectId: string,
  id: string,
  availableActions: Array<"confirm"> = ["confirm"]
): AffiliateContractReadModel {
  return {
    id,
    projectId,
    status: "pending_confirm",
    availableActions
  };
}

function contractsReadModel(
  projectId: string,
  contractId: string,
  availableActions: Array<"confirm"> = ["confirm"],
  rootActions: Array<"record_affiliate_company_contract"> = []
): AffiliateContractsReadModel {
  return {
    availableActions: rootActions,
    contracts: [
      contractReadModel(projectId, contractId, availableActions)
    ]
  };
}

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolvePromise = accept;
    reject = decline;
  });
  const resolve = (value?: T | PromiseLike<T>) => {
    resolvePromise(value as T | PromiseLike<T>);
  };
  return { promise, reject, resolve };
}

function setupPanel(projectId = "project-a") {
  const props = reactive({ projectId });
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      AffiliateCompanyContractPanel as unknown as {
        setup: (
          props: { projectId: string },
          context: { expose: () => void }
        ) => PanelBindings;
      }
    ).setup(props, { expose: () => undefined })
  );
  if (!bindings) throw new Error("affiliate company contract panel setup failed");
  return { bindings, props, scope };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("affiliate-company offline contract panel", () => {
  it("uses the governed API surface and never calls fetch directly", () => {
    expect(source).toContain("fetchProjectAffiliateCompanyContracts");
    expect(source).toContain("recordProjectAffiliateCompanyContract");
    expect(source).toContain("confirmProjectAffiliateCompanyContract");
    expect(source).toContain("uploadPrivateFile");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });

  it("keeps the owner, remittance and company-workflow boundaries explicit", () => {
    expect(source).toContain("不替代业主主合同");
    expect(source).toContain("不会生成业主回款");
    expect(source).toContain("可以先到账、后核对");
    expect(source).toContain("不以该合同结算完成为前提");
    expect(source).toContain("不是我方合同审批");
  });

  it("uses TDesign controls and the shared sensitive action confirmation", () => {
    expect(source).toContain("<t-table");
    expect(source).toContain("<t-upload");
    expect(source).toContain("<SensitiveActionDialog");
    expect(source).not.toMatch(/<button\b/u);
  });

  it("binds confirmation to the immutable server capability and the real dialog submit handler", () => {
    const registration = pageActionRegistry.actions.find(
      (action) => action.id === "affiliate-company-contract.confirm"
    );

    expect(registration?.trigger).toEqual({
      element: "sensitive-action-dialog",
      event: "confirm",
      handler: "submitConfirm"
    });
    expect(registration?.capability).toEqual({
      kind: "available_action_string",
      source: "selectedAffiliateCompanyContractActions",
      key: "confirm"
    });
    expect(source).toContain(
      "let affiliateCompanyContractCapability: ProjectAffiliateCompanyContractsReadModel | null ="
    );
    expect(source).toContain(
      "const selectedAffiliateCompanyContractActions = shallowRef<"
    );
    expect(source).toContain(
      "const affiliateCompanyContractRootActions = shallowRef<"
    );
    expect(source).toContain("data.value = structuredClone(contracts)");
    expect(source).toContain(
      "const request = confirmProjectAffiliateCompanyContract("
    );
    expect(source).toContain(
      "requireCurrentConfirmContractId(context)"
    );
    expect(source).toContain(
      'v-if="confirmActionEnabled(row.id, \'confirm\')"'
    );
    expect(source).toContain(
      'v-if="confirmArmed && selectedConfirmActionEnabled(\'confirm\')"'
    );

    const recordRegistration = pageActionRegistry.actions.find(
      (action) => action.id === "affiliate-company-contract.record"
    );
    expect(recordRegistration?.capability).toEqual({
      kind: "available_action_string",
      source: "affiliateCompanyContractRootActions",
      key: "record_affiliate_company_contract"
    });
  });

  it("does not let an older project read overwrite the current project", async () => {
    const projectA = deferred<AffiliateContractsReadModel>();
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockReturnValueOnce(projectA.promise)
      .mockResolvedValueOnce(contractsReadModel("project-b", "contract-b"));
    affiliateContractRuntime.fetchCompanies.mockReset();
    const { bindings, props, scope } = setupPanel();

    try {
      const oldLoad = bindings.load();
      props.projectId = "project-b";
      await nextTick();
      await flushPromises();

      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-b");

      projectA.resolve(contractsReadModel("project-a", "contract-a"));
      await oldLoad;
      await flushPromises();

      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-b");
      bindings.openConfirm(
        contractReadModel("project-a", "contract-a")
      );
      expect(() =>
        bindings.submitConfirm({ password: "current-password" })
      ).toThrow("线下合同确认上下文已失效");
      expect(affiliateContractRuntime.confirm).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("keeps confirmation available when the unrelated company-options request fails", async () => {
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm.mockRejectedValueOnce(
      new Error("确认接口暂时不可用")
    );
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockResolvedValue(
      contractsReadModel(
        "project-a",
        "contract-a",
        ["confirm"],
        ["record_affiliate_company_contract"]
      )
    );
    affiliateContractRuntime.fetchCompanies.mockReset();
    affiliateContractRuntime.fetchCompanies.mockRejectedValueOnce(
      new Error("企业主体读取超时")
    );
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();

      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-a");
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      await bindings.submitConfirm({ password: "current-password" });

      expect(affiliateContractRuntime.confirm).toHaveBeenCalledTimes(1);
      expect(bindings.confirmVisible.value).toBe(true);
      expect(bindings.confirmError.value).toBe("确认接口暂时不可用");
    } finally {
      scope.stop();
    }
  });

  it("invalidates an open registration before project switch can upload or write it", async () => {
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(
        contractsReadModel(
          "project-a",
          "contract-a",
          ["confirm"],
          ["record_affiliate_company_contract"]
        )
      )
      .mockResolvedValueOnce(
        contractsReadModel("project-b", "contract-b")
      );
    affiliateContractRuntime.fetchCompanies.mockReset();
    affiliateContractRuntime.fetchCompanies.mockResolvedValue([]);
    affiliateContractRuntime.upload.mockReset();
    affiliateContractRuntime.record.mockReset();
    const { bindings, props, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openRecord();
      expect(bindings.recordVisible.value).toBe(true);

      props.projectId = "project-b";
      await nextTick();
      await flushPromises();

      expect(bindings.recordVisible.value).toBe(false);
      await bindings.submitRecord();
      expect(affiliateContractRuntime.upload).not.toHaveBeenCalled();
      expect(affiliateContractRuntime.record).not.toHaveBeenCalled();
      expect(bindings.recordBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("reports current registration validation failures without uploading or setting busy", async () => {
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockResolvedValue(
      contractsReadModel(
        "project-a",
        "contract-a",
        ["confirm"],
        ["record_affiliate_company_contract"]
      )
    );
    affiliateContractRuntime.fetchCompanies.mockReset();
    affiliateContractRuntime.fetchCompanies.mockResolvedValue([]);
    affiliateContractRuntime.upload.mockReset();
    affiliateContractRuntime.record.mockReset();
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openRecord();

      await bindings.submitRecord();
      expect(bindings.recordError.value).toBe(
        "请上传已由双方线下签署的正式合同文件"
      );
      expect(bindings.recordBusy.value).toBe(false);
      expect(affiliateContractRuntime.upload).not.toHaveBeenCalled();

      bindings.signedFiles.value = [
        {
          raw: new File(["signed"], "signed.pdf", {
            type: "application/pdf"
          })
        }
      ];
      await bindings.submitRecord();
      expect(bindings.recordError.value).toBe("请填写线下合同编号");
      expect(bindings.recordBusy.value).toBe(false);
      expect(affiliateContractRuntime.upload).not.toHaveBeenCalled();
      expect(affiliateContractRuntime.record).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("does not create a contract when its upload finishes after a project switch", async () => {
    const upload = deferred<{ id: string }>();
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(
        contractsReadModel(
          "project-a",
          "contract-a",
          ["confirm"],
          ["record_affiliate_company_contract"]
        )
      )
      .mockResolvedValueOnce(
        contractsReadModel("project-b", "contract-b")
      );
    affiliateContractRuntime.fetchCompanies.mockReset();
    affiliateContractRuntime.fetchCompanies.mockResolvedValue([]);
    affiliateContractRuntime.upload.mockReset();
    affiliateContractRuntime.upload.mockReturnValueOnce(upload.promise);
    affiliateContractRuntime.record.mockReset();
    const { bindings, props, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openRecord();
      bindings.form.value = {
        contractReference: "HT-A-001",
        contractName: "项目 A 线下合同",
        signedAt: "2026-07-30",
        rightsObligationsSummary: "项目 A 已签文件",
        companyEntityId: "company-a"
      };
      bindings.signedFiles.value = [
        {
          raw: new File(["signed"], "signed.pdf", {
            type: "application/pdf"
          })
        }
      ];

      const submission = bindings.submitRecord();
      expect(affiliateContractRuntime.upload).toHaveBeenCalledTimes(1);

      props.projectId = "project-b";
      await nextTick();
      await flushPromises();
      upload.resolve({ id: "temporary-file-a" });
      await submission;

      expect(affiliateContractRuntime.record).not.toHaveBeenCalled();
      expect(bindings.recordBusy.value).toBe(false);
      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-b");
    } finally {
      scope.stop();
    }
  });

  it("ignores an upload rejection after registration switches projects", async () => {
    const upload = deferred<{ id: string }>();
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(
        contractsReadModel(
          "project-a",
          "contract-a",
          ["confirm"],
          ["record_affiliate_company_contract"]
        )
      )
      .mockResolvedValueOnce(
        contractsReadModel("project-b", "contract-b")
      );
    affiliateContractRuntime.fetchCompanies.mockReset();
    affiliateContractRuntime.fetchCompanies.mockResolvedValue([]);
    affiliateContractRuntime.upload.mockReset();
    affiliateContractRuntime.upload.mockReturnValueOnce(upload.promise);
    affiliateContractRuntime.record.mockReset();
    const { bindings, props, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openRecord();
      bindings.form.value = {
        contractReference: "HT-A-001",
        contractName: "项目 A 线下合同",
        signedAt: "2026-07-30",
        rightsObligationsSummary: "项目 A 已签文件",
        companyEntityId: "company-a"
      };
      bindings.signedFiles.value = [
        {
          raw: new File(["signed"], "signed.pdf", {
            type: "application/pdf"
          })
        }
      ];
      const submission = bindings.submitRecord();

      props.projectId = "project-b";
      await nextTick();
      await flushPromises();
      bindings.recordError.value = "项目 B 当前错误";
      bindings.recordBusy.value = true;
      upload.reject(new Error("项目 A 上传失败"));
      await submission;

      expect(affiliateContractRuntime.record).not.toHaveBeenCalled();
      expect(bindings.recordError.value).toBe("项目 B 当前错误");
      expect(bindings.recordBusy.value).toBe(true);
      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-b");
    } finally {
      scope.stop();
    }
  });

  it("freezes the registration project and reloads after one successful write", async () => {
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(
        contractsReadModel(
          "project-a",
          "contract-a",
          ["confirm"],
          ["record_affiliate_company_contract"]
        )
      )
      .mockResolvedValueOnce(
        contractsReadModel("project-a", "contract-a")
      );
    affiliateContractRuntime.fetchCompanies.mockReset();
    affiliateContractRuntime.fetchCompanies.mockResolvedValue([]);
    affiliateContractRuntime.upload.mockReset();
    affiliateContractRuntime.upload.mockResolvedValueOnce({
      id: "signed-file-a"
    });
    affiliateContractRuntime.record.mockReset();
    affiliateContractRuntime.record.mockResolvedValueOnce({});
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openRecord();
      bindings.form.value = {
        contractReference: " HT-A-001 ",
        contractName: " 项目 A 线下合同 ",
        signedAt: "2026-07-30",
        rightsObligationsSummary: " 项目 A 已签文件 ",
        companyEntityId: " company-a "
      };
      const raw = new File(["signed"], "signed.pdf", {
        type: "application/pdf"
      });
      bindings.signedFiles.value = [{ raw }];

      await bindings.submitRecord();

      expect(affiliateContractRuntime.upload).toHaveBeenCalledWith(
        raw,
        "signed.pdf"
      );
      expect(affiliateContractRuntime.record).toHaveBeenCalledWith(
        "project-a",
        expect.objectContaining({
          contractReference: "HT-A-001",
          contractName: "项目 A 线下合同",
          signedAt: "2026-07-30",
          rightsObligationsSummary: "项目 A 已签文件",
          companyEntityId: "company-a",
          fileId: "signed-file-a",
          idempotencyKey: expect.any(String)
        })
      );
      expect(bindings.recordVisible.value).toBe(false);
      expect(bindings.recordBusy.value).toBe(false);
      expect(bindings.notice.value).toContain("已签线下合同已登记");
      expect(affiliateContractRuntime.fetchContracts).toHaveBeenCalledTimes(2);
    } finally {
      scope.stop();
    }
  });

  it("clears loading when the active project becomes empty", async () => {
    const projectA = deferred<AffiliateContractsReadModel>();
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockReturnValueOnce(
      projectA.promise
    );
    const { bindings, props, scope } = setupPanel();

    try {
      const oldLoad = bindings.load();
      expect(bindings.loading.value).toBe(true);

      props.projectId = "";
      await nextTick();
      expect(bindings.loading.value).toBe(false);

      projectA.resolve(contractsReadModel("project-a", "contract-a"));
      await oldLoad;
      expect(bindings.loading.value).toBe(false);
      expect(bindings.data.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("rejects a forged table-row confirmation before calling the wrapper or setting busy", async () => {
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockResolvedValue(
      contractsReadModel("project-a", "contract-a", [])
    );
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.data.value!.contracts[0]!.availableActions = ["confirm"];
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      expect(bindings.confirmVisible.value).toBe(false);
      expect(() =>
        bindings.submitConfirm({ password: "current-password" })
      ).toThrow("线下合同确认上下文已失效");
      expect(affiliateContractRuntime.confirm).not.toHaveBeenCalled();
      expect(bindings.confirmBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("reuses one confirmation action id across a failed retry and freezes both route ids", async () => {
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm
      .mockRejectedValueOnce(new Error("网络超时"))
      .mockRejectedValueOnce(new Error("网络仍不可用"));
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockResolvedValue(
      contractsReadModel("project-a", "contract-a")
    );
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      await bindings.submitConfirm({ password: "current-password" });
      await bindings.submitConfirm({ password: "current-password" });

      expect(affiliateContractRuntime.confirm).toHaveBeenCalledTimes(2);
      const first = affiliateContractRuntime.confirm.mock.calls[0]!;
      const second = affiliateContractRuntime.confirm.mock.calls[1]!;
      expect(first[0]).toBe("project-a");
      expect(first[1]).toBe("contract-a");
      expect(first[2]).toMatchObject({
        confirmationPassword: "current-password",
        confirmationActionId: expect.any(String)
      });
      expect(second[0]).toBe("project-a");
      expect(second[1]).toBe("contract-a");
      expect(second[2].confirmationActionId).toBe(
        first[2].confirmationActionId
      );
      expect(bindings.confirmBusy.value).toBe(false);
      expect(bindings.confirmVisible.value).toBe(true);
    } finally {
      scope.stop();
    }
  });

  it("does not set busy when the confirmation wrapper throws synchronously", async () => {
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm.mockImplementationOnce(() => {
      throw new Error("同步请求创建失败");
    });
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockResolvedValue(
      contractsReadModel("project-a", "contract-a")
    );
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);

      expect(() =>
        bindings.submitConfirm({ password: "current-password" })
      ).toThrow("同步请求创建失败");
      expect(bindings.confirmBusy.value).toBe(false);
      expect(bindings.confirmVisible.value).toBe(true);
    } finally {
      scope.stop();
    }
  });

  it("generates a fresh action id only after the dialog is cancelled and reopened", async () => {
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm
      .mockRejectedValueOnce(new Error("第一次失败"))
      .mockRejectedValueOnce(new Error("第二次失败"));
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts.mockResolvedValue(
      contractsReadModel("project-a", "contract-a")
    );
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      await bindings.submitConfirm({ password: "current-password" });
      const firstActionId =
        affiliateContractRuntime.confirm.mock.calls[0]![2]
          .confirmationActionId;

      bindings.cancelConfirm();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      await bindings.submitConfirm({ password: "current-password" });
      const secondActionId =
        affiliateContractRuntime.confirm.mock.calls[1]![2]
          .confirmationActionId;

      expect(secondActionId).not.toBe(firstActionId);
    } finally {
      scope.stop();
    }
  });

  it("closes the dialog, reports success, and reloads after one confirmed write", async () => {
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm.mockResolvedValueOnce({});
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(
        contractsReadModel("project-a", "contract-a")
      )
      .mockResolvedValueOnce({
        availableActions: [],
        contracts: [
          {
            ...contractReadModel("project-a", "contract-a", []),
            status: "confirmed"
          }
        ]
      });
    const { bindings, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      await bindings.submitConfirm({ password: "current-password" });

      expect(affiliateContractRuntime.confirm).toHaveBeenCalledTimes(1);
      expect(affiliateContractRuntime.fetchContracts).toHaveBeenCalledTimes(2);
      expect(bindings.confirmVisible.value).toBe(false);
      expect(bindings.confirmTarget.value).toBeNull();
      expect(bindings.confirmBusy.value).toBe(false);
      expect(bindings.notice.value).toContain("合同主管已确认");
      expect(bindings.data.value?.contracts[0]?.status).toBe("confirmed");
    } finally {
      scope.stop();
    }
  });

  it("ignores an old confirmation rejection after switching projects", async () => {
    const pending = deferred();
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm.mockReturnValueOnce(pending.promise);
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(
        contractsReadModel("project-a", "contract-a")
      )
      .mockResolvedValueOnce(
        contractsReadModel("project-b", "contract-b")
      );
    const { bindings, props, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      const submission = bindings.submitConfirm({
        password: "current-password"
      });

      props.projectId = "project-b";
      await nextTick();
      await flushPromises();
      bindings.confirmError.value = "项目 B 当前错误";
      bindings.confirmBusy.value = true;
      const readsBeforeRejection =
        affiliateContractRuntime.fetchContracts.mock.calls.length;

      pending.reject(new Error("项目 A 旧请求失败"));
      await submission;
      await flushPromises();

      expect(affiliateContractRuntime.fetchContracts).toHaveBeenCalledTimes(
        readsBeforeRejection
      );
      expect(bindings.confirmError.value).toBe("项目 B 当前错误");
      expect(bindings.confirmBusy.value).toBe(true);
      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-b");
    } finally {
      scope.stop();
    }
  });

  it("allows only one in-flight confirmation and ignores its completion after a project switch", async () => {
    const pending = deferred();
    affiliateContractRuntime.confirm.mockReset();
    affiliateContractRuntime.confirm.mockReturnValueOnce(pending.promise);
    affiliateContractRuntime.fetchContracts.mockReset();
    affiliateContractRuntime.fetchContracts
      .mockResolvedValueOnce(contractsReadModel("project-a", "contract-a"))
      .mockResolvedValue(contractsReadModel("project-b", "contract-b"));
    const { bindings, props, scope } = setupPanel();

    try {
      await bindings.load();
      bindings.openConfirm(bindings.data.value!.contracts[0]!);
      const first = bindings.submitConfirm({
        password: "current-password"
      });
      expect(() =>
        bindings.submitConfirm({
          password: "current-password"
        })
      ).toThrow("线下合同确认上下文已失效");
      expect(affiliateContractRuntime.confirm).toHaveBeenCalledTimes(1);

      props.projectId = "project-b";
      await nextTick();
      await flushPromises();
      bindings.notice.value = "项目 B 已加载";
      bindings.confirmBusy.value = true;
      const readsBeforeCompletion =
        affiliateContractRuntime.fetchContracts.mock.calls.length;

      pending.resolve();
      await first;
      await flushPromises();

      expect(affiliateContractRuntime.fetchContracts).toHaveBeenCalledTimes(
        readsBeforeCompletion
      );
      expect(bindings.notice.value).toBe("项目 B 已加载");
      expect(bindings.confirmBusy.value).toBe(true);
      expect(bindings.data.value?.contracts[0]?.id).toBe("contract-b");
    } finally {
      scope.stop();
    }
  });
});
