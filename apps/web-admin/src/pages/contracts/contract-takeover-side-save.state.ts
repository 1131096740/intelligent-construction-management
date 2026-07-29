export interface TakeoverSideSaveAttempt<T> {
  idempotencyKey: string;
  expectedRevision: number;
  model: T;
  fingerprint: string;
}

export interface TakeoverSideSaveState<T> {
  model: T;
  revision: number;
  dirty: boolean;
  saving: boolean;
  activeAttempt: TakeoverSideSaveAttempt<T> | null;
  retryAttempt: TakeoverSideSaveAttempt<T> | null;
}

function cloneModel<T>(model: T): T {
  return JSON.parse(JSON.stringify(model)) as T;
}

function fingerprint(model: unknown): string {
  return JSON.stringify(model);
}

export function createTakeoverSideSaveState<T>(
  model: T,
  revision: number
): TakeoverSideSaveState<T> {
  return {
    model: cloneModel(model),
    revision,
    dirty: false,
    saving: false,
    activeAttempt: null,
    retryAttempt: null
  };
}

export function replaceTakeoverSideModel<T>(
  state: TakeoverSideSaveState<T>,
  model: T
): void {
  state.model = cloneModel(model);
  state.dirty = true;
}

export function beginTakeoverSideSave<T>(
  state: TakeoverSideSaveState<T>,
  createIdempotencyKey: () => string
): TakeoverSideSaveAttempt<T> {
  if (state.saving && state.activeAttempt) {
    return state.activeAttempt;
  }
  const retry = state.retryAttempt;
  const attempt = retry ?? {
    idempotencyKey: createIdempotencyKey(),
    expectedRevision: state.revision,
    model: cloneModel(state.model),
    fingerprint: fingerprint(state.model)
  };
  state.activeAttempt = attempt;
  state.retryAttempt = null;
  state.saving = true;
  return attempt;
}

export function completeTakeoverSideSave<T>(
  state: TakeoverSideSaveState<T>,
  attempt: TakeoverSideSaveAttempt<T>,
  revision: number
): void {
  if (state.activeAttempt !== attempt) {
    return;
  }
  state.revision = revision;
  state.saving = false;
  state.activeAttempt = null;
  state.retryAttempt = null;
  state.dirty = fingerprint(state.model) !== attempt.fingerprint;
}

export function failTakeoverSideSave<T>(
  state: TakeoverSideSaveState<T>,
  attempt: TakeoverSideSaveAttempt<T>,
  retryable: boolean
): void {
  if (state.activeAttempt !== attempt) {
    return;
  }
  state.saving = false;
  state.activeAttempt = null;
  state.dirty = true;
  state.retryAttempt = retryable ? attempt : null;
}
