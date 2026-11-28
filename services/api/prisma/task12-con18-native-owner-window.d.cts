export function assertTask12Con18OwnerWindow(token: object, fixture: object): boolean;
export function observeTask12Con18Signed(token: object, versionId: string, roundId: string, actorId: string): Promise<boolean>;
export function observeTask12Con18Rounds(token: object, versionId: string, withdrawnRoundId: string, newRoundId: string): Promise<{
  withdrawnRoundId: string; newRoundId: string; withdrawnStatus: string; newStatus: string;
  oldApproveCount: number; oldSignatureSnapshotsCleared: boolean;
  newApproveCount: number; newAllUnsigned: boolean; newPendingCount: number;
}>;
export function observeTask12Con18Archived(token: object, versionId: string, roundId: string, archiveId: string): Promise<boolean>;
export function closeTask12Con18OwnerWindow(token: object): Promise<{ matched: boolean; localOnly: boolean; full394Accepted: boolean }>;
