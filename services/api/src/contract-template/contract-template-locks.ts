import type {
  ContractBusinessTemplate,
  ContractBusinessTemplateVersion,
  Prisma
} from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";

export async function lockBusinessTemplateVersion(
  tx: Prisma.TransactionClient,
  versionId: string
) {
  const reference = await tx.contractBusinessTemplateVersion.findUnique({
    where: { id: versionId },
    select: { templateId: true }
  });
  if (!reference) return null;
  const [template] = await tx.$queryRaw<ContractBusinessTemplate[]>(PrismaRuntime.sql`
    SELECT * FROM "ContractBusinessTemplate"
    WHERE "id" = ${reference.templateId}
    FOR UPDATE
  `);
  const [version] = await tx.$queryRaw<ContractBusinessTemplateVersion[]>(PrismaRuntime.sql`
    SELECT * FROM "ContractBusinessTemplateVersion"
    WHERE "id" = ${versionId}
    FOR UPDATE
  `);
  if (!version || version.templateId !== reference.templateId) return null;
  if (template && version.templateId !== template.id) return null;
  return { template, version };
}
