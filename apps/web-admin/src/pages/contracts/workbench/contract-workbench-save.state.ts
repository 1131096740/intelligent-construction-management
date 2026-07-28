import type { ContractDraftChangedSection } from "../../../api/contract-workbench.api";

export type AggregateSaveSnapshot = object;
export const CONTRACT_WORKBENCH_AUTOSAVE_WINDOW_MS = 2_000;

type SectionGenerations = Record<ContractDraftChangedSection, number>;

interface AggregateSaveBase {
  serverRevision: number;
  localGeneration: number;
  ackedGeneration: number;
  changedSections: ContractDraftChangedSection[];
  sectionGenerations: SectionGenerations;
}

export interface AggregateSaveCleanState extends AggregateSaveBase {
  kind: "clean";
  changedSections: [];
}

export interface AggregateSaveDirtyState extends AggregateSaveBase {
  kind: "dirty";
  deadlineAt: number;
}

export interface AggregateSaveInFlightState<T extends AggregateSaveSnapshot>
  extends AggregateSaveBase {
  kind: "saving";
  saveKind: "auto" | "manual";
  sentGeneration: number;
  sentChangedSections: ContractDraftChangedSection[];
  sentSectionGenerations: SectionGenerations;
  inFlightSnapshot: T;
  idempotencyKey: string;
}

export interface AggregateSaveTerminalState<T extends AggregateSaveSnapshot>
  extends AggregateSaveBase {
  kind: "failed" | "conflict" | "readonly";
  saveKind: "auto" | "manual";
  reason: string;
  sentGeneration: number;
  sentChangedSections: ContractDraftChangedSection[];
  sentSectionGenerations: SectionGenerations;
  inFlightSnapshot: T;
  idempotencyKey: string;
}

export type AggregateSaveState<T extends AggregateSaveSnapshot> =
  | AggregateSaveCleanState
  | AggregateSaveDirtyState
  | AggregateSaveInFlightState<T>
  | AggregateSaveTerminalState<T>;

const SECTION_ORDER: ContractDraftChangedSection[] = [
  "draft",
  "parties",
  "bills",
  "payment_terms",
  "attachments",
  "negotiation_documents"
];

export function createAggregateSaveState<T extends AggregateSaveSnapshot>(
  serverRevision: number
): AggregateSaveState<T> {
  return {
    kind: "clean",
    serverRevision,
    localGeneration: 0,
    ackedGeneration: 0,
    changedSections: [],
    sectionGenerations: emptySectionGenerations()
  };
}

export function markAggregateSaveEdited<T extends AggregateSaveSnapshot>(
  state: AggregateSaveState<T>,
  section: ContractDraftChangedSection,
  now = Date.now()
): AggregateSaveState<T> {
  const localGeneration = state.localGeneration + 1;
  const sectionGenerations = {
    ...state.sectionGenerations,
    [section]: localGeneration
  };
  const changedSections = orderedSections([
    ...state.changedSections,
    section
  ]);
  if (state.kind === "clean") {
    return {
      ...state,
      kind: "dirty",
      localGeneration,
      changedSections,
      sectionGenerations,
      deadlineAt: now + CONTRACT_WORKBENCH_AUTOSAVE_WINDOW_MS
    };
  }
  if (state.kind === "dirty") {
    return {
      ...state,
      localGeneration,
      changedSections,
      sectionGenerations
    };
  }
  return {
    ...state,
    localGeneration,
    changedSections,
    sectionGenerations
  };
}

export function beginAggregateSave<T extends AggregateSaveSnapshot>(
  state: AggregateSaveState<T>,
  snapshot: T,
  idempotencyKey: string,
  saveKind: "auto" | "manual" = "manual"
): AggregateSaveState<T> {
  if (state.kind === "saving" || state.kind === "conflict" || state.kind === "readonly") {
    return state;
  }
  if (state.kind === "failed") {
    return {
      ...state,
      kind: "saving"
    };
  }
  if (state.kind !== "dirty") return state;
  return {
    kind: "saving",
    saveKind,
    serverRevision: state.serverRevision,
    localGeneration: state.localGeneration,
    sentGeneration: state.localGeneration,
    ackedGeneration: state.ackedGeneration,
    changedSections: [],
    sentChangedSections: [...state.changedSections],
    sectionGenerations: { ...state.sectionGenerations },
    sentSectionGenerations: { ...state.sectionGenerations },
    inFlightSnapshot: cloneSnapshot(snapshot),
    idempotencyKey
  };
}

export function completeAggregateSave<T extends AggregateSaveSnapshot>(
  state: AggregateSaveState<T>,
  serverRevision: number,
  now = Date.now()
): AggregateSaveState<T> {
  if (state.kind !== "saving") return state;
  if (state.localGeneration === state.sentGeneration) {
    return {
      kind: "clean",
      serverRevision,
      localGeneration: state.localGeneration,
      ackedGeneration: state.sentGeneration,
      changedSections: [],
      sectionGenerations: { ...state.sectionGenerations }
    };
  }
  return {
    kind: "dirty",
    serverRevision,
    localGeneration: state.localGeneration,
    ackedGeneration: state.sentGeneration,
    changedSections: [...state.changedSections],
    sectionGenerations: { ...state.sectionGenerations },
    deadlineAt: now + CONTRACT_WORKBENCH_AUTOSAVE_WINDOW_MS
  };
}

export function failAggregateSave<T extends AggregateSaveSnapshot>(
  state: AggregateSaveState<T>,
  kind: "network" | "conflict" | "readonly",
  reason: string
): AggregateSaveState<T> {
  if (state.kind !== "saving") return state;
  return {
    ...state,
    kind: kind === "network" ? "failed" : kind,
    reason
  };
}

export function rebaseAggregateSaveAfterConflict<
  T extends AggregateSaveSnapshot
>(
  state: AggregateSaveState<T>,
  serverRevision: number,
  now = Date.now()
): AggregateSaveState<T> {
  if (state.kind !== "conflict") return state;
  return {
    kind: "dirty",
    serverRevision,
    localGeneration: state.localGeneration,
    ackedGeneration: state.ackedGeneration,
    changedSections: orderedSections([
      ...state.sentChangedSections,
      ...state.changedSections
    ]),
    sectionGenerations: { ...state.sectionGenerations },
    deadlineAt: now + CONTRACT_WORKBENCH_AUTOSAVE_WINDOW_MS
  };
}

export function acceptAggregateSaveServerVersion<
  T extends AggregateSaveSnapshot
>(
  state: AggregateSaveState<T>,
  serverRevision: number
): AggregateSaveState<T> {
  return {
    kind: "clean",
    serverRevision,
    localGeneration: state.localGeneration,
    ackedGeneration: state.localGeneration,
    changedSections: [],
    sectionGenerations: { ...state.sectionGenerations }
  };
}

export function canMergeAggregateSaveDerivedFacts<
  T extends AggregateSaveSnapshot
>(
  state: AggregateSaveState<T>,
  sourceSections: ContractDraftChangedSection[]
): boolean {
  return state.kind === "saving" && sourceSections.every(
    (section) =>
      state.sectionGenerations[section] ===
      state.sentSectionGenerations[section]
  );
}

function emptySectionGenerations(): SectionGenerations {
  return {
    draft: 0,
    parties: 0,
    bills: 0,
    payment_terms: 0,
    attachments: 0,
    negotiation_documents: 0
  };
}

function orderedSections(
  sections: ContractDraftChangedSection[]
): ContractDraftChangedSection[] {
  const selected = new Set(sections);
  return SECTION_ORDER.filter((section) => selected.has(section));
}

function cloneSnapshot<T extends AggregateSaveSnapshot>(snapshot: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(snapshot);
    } catch {
      // Vue reactive proxies are not structured-cloneable. The aggregate save
      // contract is JSON-only, so the JSON clone is the correct fallback.
    }
  }
  return JSON.parse(JSON.stringify(snapshot)) as T;
}
