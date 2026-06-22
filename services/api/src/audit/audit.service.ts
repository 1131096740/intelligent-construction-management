import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

type AuditLogClient = Pick<Prisma.TransactionClient, "auditLog">;

export interface RecordAuditLogInput {
  actorUserId?: string | null;
  action: string;
  businessType?: string | null;
  businessId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  record(client: AuditLogClient, input: RecordAuditLogInput) {
    return client.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        businessType: input.businessType ?? null,
        businessId: input.businessId ?? null,
        metadata: input.metadata
      }
    });
  }
}
