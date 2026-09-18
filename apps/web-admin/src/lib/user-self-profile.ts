import { useAuthStore } from "../auth/auth.store";

/** Preserve the existing account mutation, audit and session rotation. */
export function updateProfile(name: string, phone: string, currentPassword: string) {
  return useAuthStore().updateProfile(name, phone, currentPassword);
}
