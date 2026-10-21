import { create } from "zustand";

/**
 * Transient offer to connect a Linux User, written when onboarding creates a
 * new workspace and consumed once by the workspace shell's prompt.
 *
 * Deliberately NOT persisted: a reload drops the offer, and Settings keeps
 * the same action available. The offer carries the user id so a different
 * user signing into the same tab never inherits it.
 */
export interface LinuxUserConnectionOffer {
  userId: string;
  workspaceId: string;
}

interface LinuxUserConnectionStoreState {
  offer: LinuxUserConnectionOffer | null;
  setOffer: (offer: LinuxUserConnectionOffer) => void;
  dismiss: () => void;
}

export const useLinuxUserConnectionStore =
  create<LinuxUserConnectionStoreState>((set) => ({
    offer: null,
    setOffer: (offer) => set({ offer }),
    dismiss: () => set({ offer: null }),
  }));
