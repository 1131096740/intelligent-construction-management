import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContractDetailPage from "./ContractDetailPage.vue";

const finalArchiveRuntime = vi.hoisted(() => ({
  confirmFinal: vi.fn(),
  associateFinal: vi.fn(),
  fetchDetail: vi.fn(),
  uploadPrivate: vi.fn(),
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
    fetchContractDetail: finalArchiveRuntime.fetchDetail,
    uploadMutuallySignedContract: finalArchiveRuntime.associateFinal,
    uploadPrivateFile: finalArchiveRuntime.uploadPrivate
  };
});

finalArchiveRuntime.route = reactive(finalArchiveRuntime.route);

type MutableValue<T> = { value: T };
type ContractPageBindings = {
  confirmFinalContractUpload: () => Promise<boolean>;
  confirmFinalContractConfirmation: () => Promise<boolean>;
  contractDetail: MutableValue<unknown>;
  contractFinalUploadFiles: MutableValue<Array<{ name: string; raw: File }>>;
  finalArchiveConfirmations: MutableValue<string[]>;
  finalUploadConfirmations: MutableValue<string[]>;
  requestFinalContractUpload: () => void;
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
    finalArchiveRuntime.associateFinal.mockReset();
    finalArchiveRuntime.fetchDetail.mockReset();
    finalArchiveRuntime.uploadPrivate.mockReset();
    finalArchiveRuntime.confirmFinal.mockResolvedValue({ id: "final-file-a" });
    finalArchiveRuntime.associateFinal.mockResolvedValue({ id: "final-file-a" });
    finalArchiveRuntime.uploadPrivate.mockResolvedValue({ id: "uploaded-final-file" });
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

  it("uses the current aggregate revision as OCC when document coordinates survive metadata-only drift", async () => {
    const current = finalUploadDetail({ draftRevision: 5, approvalSourceRevision: 4 });
    finalArchiveRuntime.fetchDetail.mockResolvedValue(current);
    const { bindings, scope } = setupFinalArchivePage();
    try {
      bindings.contractDetail.value = current;
      bindings.contractFinalUploadFiles.value = [{
        name: "双方最终版.pdf",
        raw: new File(["final"], "双方最终版.pdf", { type: "application/pdf" })
      }];
      bindings.finalUploadConfirmations.value = [...confirmations];

      bindings.requestFinalContractUpload();
      expect(bindings.sensitiveAction.kind).toBe("finalUpload");
      await expect(bindings.confirmFinalContractUpload()).resolves.toBe(true);

      expect(finalArchiveRuntime.associateFinal).toHaveBeenCalledWith("version-a", {
        fileId: "uploaded-final-file",
        sourceRevision: 5,
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

  it("stops before private upload when the fresh document coordinates changed", async () => {
    const current = finalUploadDetail();
    finalArchiveRuntime.fetchDetail.mockResolvedValueOnce(finalUploadDetail({
      documentContentRevision: 3,
      documentContentFingerprint: "e".repeat(64)
    }));
    const { bindings, scope } = setupFinalArchivePage();
    try {
      bindings.contractDetail.value = current;
      bindings.contractFinalUploadFiles.value = [{
        name: "双方最终版.pdf",
        raw: new File(["final"], "双方最终版.pdf", { type: "application/pdf" })
      }];
      bindings.finalUploadConfirmations.value = [...confirmations];

      bindings.requestFinalContractUpload();
      await expect(bindings.confirmFinalContractUpload()).resolves.toBe(false);
      expect(finalArchiveRuntime.uploadPrivate).not.toHaveBeenCalled();
      expect(finalArchiveRuntime.associateFinal).not.toHaveBeenCalled();
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

function finalUploadDetail(overrides: {
  approvalSourceRevision?: number;
  documentContentFingerprint?: string;
  documentContentRevision?: number;
  draftRevision?: number;
} = {}) {
  const documentContentRevision = overrides.documentContentRevision ?? 2;
  const documentContentFingerprint = overrides.documentContentFingerprint ?? "d".repeat(64);
  return {
    ...finalArchiveDetail({
      id: "2a888482-565d-4326-a668-d8072cf480ca",
      availableActionKeys: ["upload_final_contract"]
    }),
    draftRevision: overrides.draftRevision ?? 5,
    documentContentRevision,
    documentContentFingerprint,
    formalFiles: [{
      formalFileId: "approval-original-a",
      purpose: "approval_original",
      fileId: "approval-original-file-a",
      fileName: "审批前乙方签章原件.pdf",
      pageCount: 3,
      sourceRevision: overrides.approvalSourceRevision ?? 4,
      documentContentRevision,
      documentContentFingerprint,
      status: "active",
      uploadedByUserId: "user-a",
      confirmedByUserId: null,
      confirmedAt: null
    }],
    availableActions: [{
      key: "upload_final_contract",
      label: "上传双方最终版",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredRoles: []
    }]
  };
}
