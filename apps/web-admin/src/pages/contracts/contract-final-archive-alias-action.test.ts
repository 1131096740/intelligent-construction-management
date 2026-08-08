import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContractDetailPage from "./ContractDetailPage.vue";

const finalArchiveRuntime = vi.hoisted(() => ({
  confirmFinal: vi.fn(),
  fetchDetail: vi.fn(),
  route: { params: { contractId: "2a888482-565d-4326-a668-d8072cf480ca" } }
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: () => undefined,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => finalArchiveRuntime.route,
    useRouter: () => ({ push: vi.fn() })
  };
});

vi.mock("../../auth/auth.store", () => ({
  useAuthStore: () => ({ user: { roleKeys: [] } })
}));

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../api/core-flow-read.api")>();
  return {
    ...original,
    confirmMutuallySignedContract: finalArchiveRuntime.confirmFinal,
    fetchContractDetail: finalArchiveRuntime.fetchDetail
  };
});

finalArchiveRuntime.route = reactive(finalArchiveRuntime.route);

type MutableValue<T> = { value: T };
type ContractPageBindings = {
  confirmFinalContractConfirmation: () => Promise<boolean>;
  contractDetail: MutableValue<unknown>;
  finalArchiveConfirmations: MutableValue<string[]>;
  requestFinalContractConfirmation: () => void;
  sensitiveAction: {
    kind: string | null;
    targetRouteContractId: string;
    targetContractVersionId: string;
    visible: boolean;
  };
};

const confirmations = [
  "firstPartySignedOrStamped",
  "companySealCompleted",
  "crossPageSealCompleted",
  "signingDateCompleted",
  "onlyPermittedSignatureChanges",
  "documentOrderConfirmed"
];

describe("contract final archive UUID route", () => {
  beforeEach(() => {
    finalArchiveRuntime.route.params.contractId = "2a888482-565d-4326-a668-d8072cf480ca";
    finalArchiveRuntime.confirmFinal.mockReset();
    finalArchiveRuntime.fetchDetail.mockReset();
    finalArchiveRuntime.confirmFinal.mockResolvedValue({ id: "final-file-a" });
    finalArchiveRuntime.fetchDetail.mockResolvedValue(finalArchiveDetail());
  });

  it("confirms a final archive from a UUID detail route even when the detail display id is the contract code", async () => {
    const { bindings, scope } = setupFinalArchivePage();
    try {
      bindings.requestFinalContractConfirmation();
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("finalConfirm");
      expect(bindings.sensitiveAction.targetRouteContractId).toBe(
        "2a888482-565d-4326-a668-d8072cf480ca"
      );

      await expect(bindings.confirmFinalContractConfirmation()).resolves.toBe(true);

      expect(finalArchiveRuntime.confirmFinal).toHaveBeenCalledWith("version-a", {
        formalFileId: "final-file-a",
        firstPartySignedOrStamped: true,
        companySealCompleted: true,
        crossPageSealCompleted: true,
        signingDateCompleted: true,
        onlyPermittedSignatureChanges: true,
        documentOrderConfirmed: true
      });
    } finally {
      scope.stop();
    }
  });

  it("does not submit a captured final archive action after navigation to another contract", async () => {
    const { bindings, scope } = setupFinalArchivePage();
    try {
      bindings.requestFinalContractConfirmation();
      finalArchiveRuntime.route.params.contractId = "0e1ebed7-5bfd-4f2b-8e33-1021f95d1c9c";
      bindings.contractDetail.value = finalArchiveDetail({
        id: "HT-OTHER-001",
        contractVersionId: "version-b",
        formalFileId: "final-file-b"
      });
      await nextTick();

      await expect(bindings.confirmFinalContractConfirmation()).resolves.toBe(false);
      expect(finalArchiveRuntime.confirmFinal).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("does not submit when fresh detail for the same UUID route reports another contract version", async () => {
    finalArchiveRuntime.fetchDetail.mockResolvedValueOnce(finalArchiveDetail({
      contractVersionId: "version-b",
      formalFileId: "final-file-b"
    }));
    const { bindings, scope } = setupFinalArchivePage();
    try {
      bindings.requestFinalContractConfirmation();

      await expect(bindings.confirmFinalContractConfirmation()).resolves.toBe(false);
      expect(finalArchiveRuntime.fetchDetail).toHaveBeenCalledWith(
        "2a888482-565d-4326-a668-d8072cf480ca"
      );
      expect(finalArchiveRuntime.confirmFinal).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("does not submit when the fresh UUID capability revokes final archive confirmation", async () => {
    finalArchiveRuntime.fetchDetail.mockResolvedValueOnce(finalArchiveDetail({
      availableActionKeys: []
    }));
    const { bindings, scope } = setupFinalArchivePage();
    try {
      bindings.requestFinalContractConfirmation();

      await expect(bindings.confirmFinalContractConfirmation()).resolves.toBe(false);
      expect(finalArchiveRuntime.fetchDetail).toHaveBeenCalledWith(
        "2a888482-565d-4326-a668-d8072cf480ca"
      );
      expect(finalArchiveRuntime.confirmFinal).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });
});

function setupFinalArchivePage() {
  const scope = effectScope();
  const bindings = scope.run(() => (
    ContractDetailPage as unknown as {
      setup: (
        props: Record<string, never>,
        context: { expose: () => void }
      ) => ContractPageBindings;
    }
  ).setup({}, { expose: () => undefined }));
  if (!bindings) throw new Error("contract detail setup failed");
  bindings.contractDetail.value = finalArchiveDetail();
  bindings.finalArchiveConfirmations.value = [...confirmations];
  return { bindings, scope };
}

function finalArchiveDetail(overrides: {
  availableActionKeys?: string[];
  contractVersionId?: string;
  formalFileId?: string;
  id?: string;
} = {}) {
  const contractVersionId = overrides.contractVersionId ?? "version-a";
  const formalFileId = overrides.formalFileId ?? "final-file-a";
  return {
    id: overrides.id ?? "HT-20260809-007",
    contractVersionId,
    title: "合同详情",
    meta: [],
    baseInfo: [],
    effectivenessSteps: [],
    paymentTermStages: [],
    settlementBlockMessage: "",
    settlementPayment: {
      summary: [],
      settlementRows: [],
      paymentRows: [],
      calculationNote: ""
    },
    archiveFiles: [],
    formalFiles: [{
      formalFileId,
      purpose: "mutually_signed_final",
      fileId: "file-a",
      fileName: "双方最终版.pdf",
      pageCount: 1,
      sourceRevision: 1,
      status: "active",
      uploadedByUserId: "user-a",
      confirmedByUserId: null,
      confirmedAt: null
    }],
    approvalTimeline: [],
    availableActions: [{
      key: "confirm_final_contract",
      label: "确认归档",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredRoles: []
    }],
    availableActionKeys: overrides.availableActionKeys ?? ["confirm_final_contract"],
    reviewApprovalContext: null,
    withdrawApprovalContext: null,
    primaryAction: null,
    disabledReasons: [],
    chainLinks: [],
    changeVersions: []
  };
}
