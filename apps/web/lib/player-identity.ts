// Resolves who is playing so Unity never invents its own identity. Signed-in
// users get their Better Auth user id + nickname (see PlayShell); visitors get
// a guest identity persisted in localStorage so every tab of the same browser
// is the same player — required for one-room/one-game-per-player enforcement.

export interface PlayerIdentity {
  playerId: string;
  displayName: string;
}

const GUEST_STORAGE_KEY = "gp:guest-identity";

function generateGuestIdentity(): PlayerIdentity {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    playerId: `guest_${crypto.randomUUID().replace(/-/g, "")}`,
    displayName: `Guest-${suffix}`,
  };
}

export function getGuestIdentity(): PlayerIdentity {
  try {
    const stored = localStorage.getItem(GUEST_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PlayerIdentity>;
      if (typeof parsed.playerId === "string" && typeof parsed.displayName === "string") {
        return { playerId: parsed.playerId, displayName: parsed.displayName };
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
