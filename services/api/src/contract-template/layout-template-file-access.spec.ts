import { resolveLayoutTemplateFileAccess } from "./layout-template-file-access";

function fixture(status = "published", role = "employee", source = false) {
  const version = { id: "v1", layoutTemplateId: "layout", docxFileId: "source", previewPdfFileId: "pdf", status, draftRevision: 2 };
  const tx = {
    contractLayoutTemplate: { findMany: jest.fn().mockResolvedValue([{ id: "layout" }]), findUnique: jest.fn().mockResolvedValue({ id: "layout" }) },
    contractLayoutTemplateVersion: {
      findMany: jest.fn().mockResolvedValue([version]),
      findUnique: jest.fn().mockResolvedValue(version)
    },
    contractLayoutPreviewJob: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position" }]) },
    position: { findMany: jest.fn().mockResolvedValue([{ key: role }]) }
  };
  return { tx, fileId: source ? "source" : "pdf" };
}

describe("版式资料访问沿用版式资源查看规则", () => {
  it.each(["employee", "chairman", "finance_staff", "contract_staff", "contract_director", "super_admin"])(
    "已发布 PDF 样张对现有已发布列表读者 %s 可读", async (role) => {
      const { tx, fileId } = fixture("published", role);
      await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/pdf")).resolves.toBe(true);
    }
  );
  it.each(["draft", "submitted", "stopped", "revoked", "discarded"])("%s 版式仅公司合同岗可读", async (status) => {
    for (const role of ["employee", "chairman", "finance_staff", "super_admin", "contract_staff", "contract_director"]) {
      const { tx, fileId } = fixture(status, role);
      await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/pdf"))
        .resolves.toBe(["contract_staff", "contract_director"].includes(role));
      expect(tx.userPosition.findMany).toHaveBeenCalledWith({ where: { userId: "reader", projectId: null } });
    }
  });
  it("已发布列表不存在的孤立版本及非 PDF 指针不开放给普通读者", async () => {
    const { tx, fileId } = fixture();
    await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/octet-stream")).resolves.toBe(false);
    tx.contractLayoutTemplate.findMany.mockResolvedValue([]);
    await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/pdf")).resolves.toBe(false);
  });
  it("当前修订最新成功任务才可作为草稿样张，孤立和被取代的任务拒绝", async () => {
    const { tx } = fixture("draft", "contract_staff");
    tx.contractLayoutTemplateVersion.findMany.mockResolvedValue([]);
    tx.contractLayoutPreviewJob.findMany.mockResolvedValue([{ id: "job", layoutTemplateVersionId: "v1", status: "succeeded", sourceRevision: 2 } as never]);
    tx.contractLayoutPreviewJob.findFirst.mockResolvedValue({ id: "job" } as never);
    await expect(resolveLayoutTemplateFileAccess(tx as never, "job-pdf", "reader", "application/pdf")).resolves.toBe(true);
    tx.contractLayoutPreviewJob.findFirst.mockResolvedValue({ id: "new-job" } as never);
    await expect(resolveLayoutTemplateFileAccess(tx as never, "job-pdf", "reader", "application/pdf")).resolves.toBe(false);
    tx.contractLayoutTemplate.findUnique.mockResolvedValue(null as never);
    await expect(resolveLayoutTemplateFileAccess(tx as never, "job-pdf", "reader", "application/pdf")).resolves.toBe(false);
  });
  it("源 DOCX、停用用户及撤销岗位不随已发布样张放开", async () => {
    const { tx, fileId } = fixture("published", "employee", true);
    await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/pdf")).resolves.toBe(false);
    tx.user.findUnique.mockResolvedValue({ isActive: false });
    await expect(resolveLayoutTemplateFileAccess(tx as never, "pdf", "reader", "application/pdf")).resolves.toBe(false);
    tx.user.findUnique.mockResolvedValue({ isActive: true });
    tx.position.findMany.mockResolvedValue([{ key: "contract_staff" }]);
    await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/pdf")).resolves.toBe(true);
    tx.userPosition.findMany.mockResolvedValue([]);
    await expect(resolveLayoutTemplateFileAccess(tx as never, fileId, "reader", "application/pdf")).resolves.toBe(false);
  });
  it("未绑定文件仍交给原私有文件规则，废弃任务输出不放行上传人", async () => {
    const { tx } = fixture("draft", "contract_staff");
    tx.contractLayoutTemplateVersion.findMany.mockResolvedValue([]);
    await expect(resolveLayoutTemplateFileAccess(tx as never, "unrelated", "uploader", "application/pdf")).resolves.toBeNull();
    tx.contractLayoutPreviewJob.findMany.mockResolvedValue([
      { layoutTemplateVersionId: "v1", status: "succeeded", sourceRevision: 1 } as never
    ]);
    await expect(resolveLayoutTemplateFileAccess(tx as never, "old-pdf", "uploader", "application/pdf")).resolves.toBe(false);
  });
});
