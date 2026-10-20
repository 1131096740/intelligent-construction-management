import type { Prisma } from "@prisma/client";

export const LAYOUT_TEMPLATE_READ_ROLES = ["contract_staff", "contract_director"] as const;

/** null means this file is not a layout resource; other private-file rules still apply. */
export async function resolveLayoutTemplateFileAccess(
  tx: Prisma.TransactionClient,
  fileId: string,
  actorUserId: string,
  mimeType: string
): Promise<boolean | null> {
  // These tables predate every supported runtime; optional access supports narrow unit fixtures.
  const versions = await tx.contractLayoutTemplateVersion?.findMany({
    where: { OR: [{ docxFileId: fileId }, { previewPdfFileId: fileId }] }
  }) ?? [];
  const jobs = await tx.contractLayoutPreviewJob?.findMany({
    where: { previewPdfFileId: fileId }
  }) ?? [];
  if (!versions.length && !jobs.length) return null;
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
  if (!user?.isActive) return false;

  const templates = versions.length ? await tx.contractLayoutTemplate.findMany({
    where: { id: { in: versions.map((version) => version.layoutTemplateId) } }, select: { id: true }
  }) : [];
  const existingTemplates = new Set(templates.map((template) => template.id));
  const visibleVersions = versions.filter((version) => existingTemplates.has(version.layoutTemplateId));
  // Published-list readers may read its PDF sample, never the source DOCX or an old job output.
  if (mimeType === "application/pdf" && !versions.some((version) => version.docxFileId === fileId) &&
      visibleVersions.some((version) => version.status === "published" && version.previewPdfFileId === fileId)) {
    return true;
  }
  const assignments = await tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } });
  const positions = assignments.length ? await tx.position.findMany({
    where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
  }) : [];
  if (!positions.some((position) => LAYOUT_TEMPLATE_READ_ROLES.some((role) => role === position.key))) {
    return false;
  }
  if (visibleVersions.length) return true;
  for (const job of jobs) {
    const version = await tx.contractLayoutTemplateVersion.findUnique({
      where: { id: job.layoutTemplateVersionId }
    });
    if (version && ["draft", "submitted"].includes(version.status) &&
        job.status === "succeeded" && job.sourceRevision === version.draftRevision) {
      if (!await tx.contractLayoutTemplate.findUnique({ where: { id: version.layoutTemplateId }, select: { id: true } })) continue;
      const latest = await tx.contractLayoutPreviewJob.findFirst({
        where: { layoutTemplateVersionId: version.id, sourceRevision: version.draftRevision },
        orderBy: { createdAt: "desc" }
      });
      if (latest?.id === job.id) return true;
    }
  }
  return false;
}
