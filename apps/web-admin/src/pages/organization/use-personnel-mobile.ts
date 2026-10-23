import { onBeforeUnmount, ref } from "vue";

export function usePersonnelMobile() {
  const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 767px)") : undefined;
  const mobile = ref(media?.matches ?? false);
  const update = (event: MediaQueryListEvent) => { mobile.value = event.matches; };
  media?.addEventListener("change", update);
  onBeforeUnmount(() => media?.removeEventListener("change", update));
  return mobile;
}
