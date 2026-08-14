import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type {
  AppendOperatingFactInput,
  OperatingLedgerTransaction
} from "./operating-ledger.service";

export interface OperatingSourceSnapshot {
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceBusinessCode: string;
  sourceVersion: number;
  status: "confirmed";
  sourceSnapshot: Prisma.InputJsonObject;
}

export interface OperatingSourceLocator {
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
}

export interface OperatingSourceAdapter {
  readonly sourceType: string;
  readProjectSnapshots(
    tx: OperatingLedgerTransaction,
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]>;
  readSourceSnapshot(
    tx: OperatingLedgerTransaction,
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null>;
  toOperatingFactInput(snapshot: OperatingSourceSnapshot): AppendOperatingFactInput;
}

export class OperatingSourceAdapterRegistry {
  private readonly adapters: readonly OperatingSourceAdapter[];
  private readonly adaptersBySourceType: ReadonlyMap<string, OperatingSourceAdapter>;

  constructor(adapters: readonly OperatingSourceAdapter[]) {
    const copied = [...adapters];
    const bySourceType = new Map<string, OperatingSourceAdapter>();
    for (const adapter of copied) {
      const sourceType = requiredText(adapter.sourceType, "经营来源适配器类型不能为空");
      if (sourceType !== adapter.sourceType) {
        throw new BadRequestException("经营来源适配器类型不能包含首尾空格");
      }
      if (bySourceType.has(sourceType)) {
        throw new BadRequestException(`经营来源适配器重复：${sourceType}`);
      }
      bySourceType.set(sourceType, adapter);
    }
    this.adapters = Object.freeze(copied);
    this.adaptersBySourceType = bySourceType;
  }

  list(): readonly OperatingSourceAdapter[] {
    return this.adapters;
  }

  require(sourceType: string): OperatingSourceAdapter {
    const normalized = requiredText(sourceType, "经营来源类型不能为空");
    const adapter = this.adaptersBySourceType.get(normalized);
    if (!adapter) {
      throw new BadRequestException(`缺少经营来源适配器：${normalized}`);
    }
    return adapter;
  }
}

export function mapOperatingSourceSnapshot(
  adapter: OperatingSourceAdapter,
  snapshot: OperatingSourceSnapshot,
  expected?: OperatingSourceLocator
): AppendOperatingFactInput {
  if (snapshot.status !== "confirmed") {
    throw new BadRequestException("只有正式来源快照可以重放或参与一致性校验");
  }
  requiredText(snapshot.projectId, "来源快照项目不能为空");
  requiredText(snapshot.sourceType, "来源快照类型不能为空");
  requiredText(snapshot.sourceBusinessId, "来源快照业务标识不能为空");
  requiredText(snapshot.sourceBusinessCode, "来源快照中文业务编号不能为空");
  if (!Number.isSafeInteger(snapshot.sourceVersion) || snapshot.sourceVersion <= 0) {
    throw new BadRequestException("来源快照版本必须是正整数");
  }
  if (snapshot.sourceType !== adapter.sourceType) {
    throw new BadRequestException("来源快照与适配器类型不一致");
  }
  if (
    expected &&
    (snapshot.projectId !== expected.projectId ||
      snapshot.sourceType !== expected.sourceType ||
      snapshot.sourceBusinessId !== expected.sourceBusinessId)
  ) {
    throw new BadRequestException("来源快照与请求坐标不一致");
  }

  const input = adapter.toOperatingFactInput(snapshot);
  if (
    input.projectId !== snapshot.projectId ||
    input.sourceType !== snapshot.sourceType ||
    input.sourceBusinessId !== snapshot.sourceBusinessId ||
    input.sourceBusinessCode !== snapshot.sourceBusinessCode ||
    input.sourceVersion !== snapshot.sourceVersion ||
    !sameJson(input.sourceSnapshot, snapshot.sourceSnapshot)
  ) {
    throw new BadRequestException("来源适配器输出与冻结来源坐标不一致");
  }
  return input;
}

export function requireOperatingSourceSnapshot(
  snapshot: OperatingSourceSnapshot | null,
  locator: OperatingSourceLocator
): OperatingSourceSnapshot {
  if (!snapshot) {
    throw new NotFoundException(
      `经营来源不存在：${locator.sourceType}/${locator.sourceBusinessId}`
    );
  }
  return snapshot;
}

function sameJson(left: Prisma.InputJsonValue, right: Prisma.InputJsonValue): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}

function requiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}
