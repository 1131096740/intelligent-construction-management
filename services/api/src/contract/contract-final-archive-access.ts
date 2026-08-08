import { Prisma } from "@prisma/client";

type FinalArchiveAccessClient = Pick<
  Prisma.TransactionClient,
  "position" | "projectMember" | "user" | "userPosition"
>;

export type GovernedFinalArchiveAccess = {
  actingRoleKey: "contract_director" | "contract_staff" | null;
  canUpload: boolean;
  canConfirm: boolean;
  canSelfConfirm: boolean;
};

export async function resolveGovernedFinalArchiveAccess(
  client: FinalArchiveAccessClient,
  input: {
    actorUserId: string;
    projectId: string;
    handlerUserId: string;
    uploadedByUserId?: string | null;
  }
): Promise<GovernedFinalArchiveAccess> {
  const actor = await client.user.findUnique({
    where: { id: input.actorUserId },
    select: { isActive: true }
  });
  if (!actor?.isActive) {
    return { actingRoleKey: null, canUpload: false, canConfirm: false, canSelfConfirm: false };
  }

  const [directorPosition, contractStaffMembership] = await Promise.all([
    client.position.findUnique({ where: { key: "contract_director" }, select: { id: true } }),
    client.projectMember.findFirst({
      where: {
        projectId: input.projectId,
        userId: input.actorUserId,
        positionKey: "contract_staff"
      },
      select: { id: true }
    })
  ]);
  const globalDirectorAssignment = directorPosition
    ? await client.userPosition.findFirst({
        where: {
          userId: input.actorUserId,
          projectId: null,
          positionId: directorPosition.id
        },
        select: { id: true }
      })
    : null;
  const isCurrentGlobalDirector = Boolean(globalDirectorAssignment);
  const isCurrentContractStaff = Boolean(contractStaffMembership);
  const isHandler = input.handlerUserId === input.actorUserId;
  const actingRoleKey = isCurrentGlobalDirector
    ? "contract_director"
    : isHandler && isCurrentContractStaff
      ? "contract_staff"
      : null;

  return {
    actingRoleKey,
    canUpload: Boolean(isHandler && actingRoleKey),
    canConfirm: isCurrentGlobalDirector,
    canSelfConfirm: Boolean(
      isHandler &&
      isCurrentGlobalDirector &&
      input.uploadedByUserId === input.actorUserId
    )
  };
}
