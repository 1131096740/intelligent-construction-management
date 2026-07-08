export interface MutableFileSelection {
  value: File | null;
}

export interface ResettableFileInput {
  value: string;
}

export function clearSelectedFileInput(
  selection: MutableFileSelection,
  input: ResettableFileInput | null | undefined
) {
  selection.value = null;
  if (input) {
    input.value = "";
  }
}
