import type {
  WorkbenchSummaryCardReadModel,
  WorkbenchSummaryReadModel
} from "../../api/core-flow-read.api";

export interface WorkbenchCardViewModel extends WorkbenchSummaryCardReadModel {
  countText: string;
  toneClass: string;
}

export function toWorkbenchCards(
  summary: WorkbenchSummaryReadModel | null | undefined
): WorkbenchCardViewModel[] {
  return (summary?.cards ?? []).map((card) => ({
    ...card,
    countText: String(card.count),
    toneClass: `tone-${card.tone}`
  }));
}

export function hasWorkbenchPermissionData(
  summary: WorkbenchSummaryReadModel | null | undefined
): boolean {
  return (summary?.cards.length ?? 0) > 0;
}

export function hasOpenWorkbenchItems(cards: readonly WorkbenchCardViewModel[]): boolean {
  return cards.some((card) => card.count > 0);
}
