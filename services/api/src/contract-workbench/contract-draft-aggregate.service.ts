import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ContractWorkbenchService } from "./contract-workbench.service";

const EDITABLE_CONTRACT_DRAFT_STATUSES = new Set(["draft", "approval_rejected"]);

@Injectable()
export class ContractDraftAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workbench: ContractWorkbenchService
  ) {}

  async getWorkbench(contractVersionId: string, actorUserId: string) {
    const version = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) {
      throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    }
    if (!EDITABLE_CONTRACT_DRAFT_STATUSES.has(version.status)) {
      throw new BadRequestException("合同版本当前不可按草稿办理，请刷新后重试");
    }

    const legacyReadModel = await this.workbench.getDraftFromExactVersion(
      version,
      actorUserId
    );
    const [attachments, lease] = await Promise.all([
      this.prisma.contractDraftAttachment.findMany({
        where: { contractVersionId },
        orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }]
      }),
      this.prisma.contractDraftEditLease.findUnique({
        where: { contractVersionId }
      })
    ]);
    const now = new Date();
    const leaseExpired = lease ? lease.expiresAt.getTime() <= now.getTime() : false;
    const holder = lease && !leaseExpired
      ? await this.prisma.user.findUnique({
          where: { id: lease.holderUserId },
          select: { name: true }
        })
      : null;
    const leaseState = !lease || leaseExpired
      ? "available"
      : lease.holderUserId === actorUserId
        ? "held_by_me"
        : "held_by_other";
    const legacyWithoutCheckpoints = { ...legacyReadModel };
    Reflect.deleteProperty(legacyWithoutCheckpoints, "checkpoints");
    return {
      ...legacyWithoutCheckpoints,
      version: {
        ...legacyReadModel.version,
        draftLifecycleKind: legacyReadModel.lifecycleKind
      },
      draft: version.draftData,
      attachments,
      lease: {
        state: leaseState,
        holderDisplayName: holder?.name ?? null,
        expiresAt: lease && !leaseExpired ? lease.expiresAt.toISOString() : null,
        canTakeOver: false
      }
    };
  }
}
