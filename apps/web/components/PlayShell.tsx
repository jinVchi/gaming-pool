"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/auth-client";
import { getGuestIdentity } from "@/lib/player-identity";

// Load Unity only in the browser after Play (WebGL needs window/DOM).
const UnityLoader = dynamic(() => import("./UnityLoader").then((m) => m.UnityLoader), {
  ssr: false,
});

// Cross-tab lock so only one Unity instance runs per browser profile.
const UNITY_LOCK_NAME = "gaming-pool:unity-game";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Signed identity returned by POST /player-token for matchmaking + WebSocket.
interface PlayerCredential {
  playerId: string;
  displayName: string;
  token: string;
}

export function PlayShell({ slug }: { slug: string }) {
  // Better Auth session decides signed-in vs guest token exchange.
  const { data: session, isPending } = useSession();
  // Play flow: idle → fetching credential → Unity mounted.
  const [started, setStarted] = useState(false);
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false);
  const [credential, setCredential] = useState<PlayerCredential | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialAttempt, setCredentialAttempt] = useState(0);

  useEffect(() => {
    // Probe whether another tab already holds the Unity lock.
    if (!("locks" in navigator)) return;
    void navigator.locks.query().then((state) => {
      if (state.held?.some((lock) => lock.name === UNITY_LOCK_NAME)) {
        setLockedByOtherTab(true);
      }
    });
  }, []);

  useEffect(() => {
    // Exchange session cookie or guest credential for a short-lived game token.
    if (!started || isPending || credential) return;
    let cancelled = false;
    const guest = session?.user ? null : getGuestIdentity();

    void fetch(`${API_URL}/player-token`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        guest ? { guestCredential: guest.guestCredential, displayName: guest.displayName } : {},
      ),
    })
      .then(async (response) => {
        // Accept only a complete credential payload from the API.
        const body = (await response.json().catch(() => ({}))) as Partial<PlayerCredential> & { error?: string };
        if (!response.ok || !body.playerId || !body.displayName || !body.token) {
          throw new Error(body.error ?? `player credential request failed (${response.status})`);
        }
        if (!cancelled) setCredential({ playerId: body.playerId, displayName: body.displayName, token: body.token });
      })
      .catch((err: unknown) => {
        // Surface fetch/parse failures for the Retry UI.
        if (!cancelled) setCredentialError((err as Error).message);
      });

    return () => {
      // Ignore late responses after unmount or dependency change.
      cancelled = true;
    };
  }, [credential, credentialAttempt, isPending, session?.user, started]);

  function handlePlay() {
    // Claim the Unity lock (or start immediately if Web Locks unsupported).
    if (!("locks" in navigator)) {
      setStarted(true);
      return;
    }
    void navigator.locks.request(UNITY_LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        // Another tab holds the lock — do not start.
        setLockedByOtherTab(true);
        return;
      }
      setLockedByOtherTab(false);
      setStarted(true);
      // Never resolve: keeps the lock held until this tab unloads.
      return new Promise<void>(() => {});
    });
  }

  if (!started) {
    // Idle: show Play until the user starts (and warn if another tab is busy).
    return (
      <div className="play-shell">
        <button type="button" className="play-button" onClick={handlePlay} disabled={isPending}>
          Play
        </button>
        {lockedByOtherTab && (
          <p className="game-status" role="alert">
            A game is already running in another tab. Close it first, then press Play again.
          </p>
        )}
      </div>
    );
  }

  if (!credential) {
    // Waiting for / retrying the player-token exchange.
    return (
      <div className="play-shell">
        <p className="game-status" role={credentialError ? "alert" : undefined}>
          {credentialError ?? "Preparing a secure game connection..."}
        </p>
        {credentialError && (
          <button
            type="button"
            className="play-button"
            onClick={() => {
              // Clear error and bump attempt so the fetch effect re-runs.
              setCredentialError(null);
              setCredentialAttempt((attempt) => attempt + 1);
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // Credential ready — mount Unity with signed identity.
  return (
    <div className="play-shell">
      <UnityLoader
        slug={slug}
        playerId={credential.playerId}
        displayName={credential.displayName}
        playerToken={credential.token}
      />
    </div>
  );
}
