// Persist a private guest credential across tabs. The API derives the public
// player id and signs it, so a lobby-visible guest id cannot be impersonated.

export interface GuestIdentity {
  guestCredential: string;
  displayName: string;
}

const GUEST_STORAGE_KEY = "gp:guest-identity";

function generateGuestIdentity(): GuestIdentity {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    guestCredential: crypto.randomUUID().replace(/-/g, ""),
    displayName: `Guest-${suffix}`,
  };
}

export function getGuestIdentity(): GuestIdentity {
  try {
    const stored = localStorage.getItem(GUEST_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<GuestIdentity>;
      if (typeof parsed.guestCredential === "string" && typeof parsed.displayName === "string") {
        return { guestCredential: parsed.guestCredential, displayName: parsed.displayName };
      }
    }
  } catch {
    // corrupted/inaccessible storage — fall through and regenerate
  }

  const identity = generateGuestIdentity();
  try {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // private mode with blocked storage: identity is per-page-load only
  }
  return identity;
}
