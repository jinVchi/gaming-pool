"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/auth-client";
import { getGuestIdentity } from "@/lib/player-identity";

const UnityLoader = dynamic(() => import("./UnityLoader").then((m) => m.UnityLoader), {
  ssr: false,
});

// Browser-wide exclusive lock held while any Unity game runs in this browser
// profile — a second tab can't even start the Unity instance. Released
// automatically when the tab closes or does a full page load away (leaving a
// game page is always a full load, see AGENTS.md game-server rules).
const UNITY_LOCK_NAME = "gaming-pool:unity-game";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface PlayerCredential {
  playerId: string;
  displayName: string;
  token: string;
}

export function PlayShell({ slug }: { slug: string }) {
  const { data: session, isPending } = useSession();
  const [started, setStarted] = useState(false);
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false);
  const [credential, setCredential] = useState<PlayerCredential | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialAttempt, setCredentialAttempt] = useState(0);

  useEffect(() => {
    // Warn up front if a game is already running in another tab.
    if (!("locks" in navigator)) return;
    void navigator.locks.query().then((state) => {
      if (state.held?.some((lock) => lock.name === UNITY_LOCK_NAME)) {
        setLockedByOtherTab(true);
      }
    });
  }, []);

  useEffect(() => {
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
        const body = (await response.json().catch(() => ({}))) as Partial<PlayerCredential> & { error?: string };
        if (!response.ok || !body.playerId || !body.displayName || !body.token) {
          throw new Error(body.error ?? `player credential request failed (${response.status})`);
        }
        if (!cancelled) setCredential({ playerId: body.playerId, displayName: body.displayName, token: body.token });
      })
      .catch((err: unknown) => {
        if (!cancelled) setCredentialError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [credential, credentialAttempt, isPending, session?.user, started]);

  function handlePlay() {
    if (!("locks" in navigator)) {
      setStarted(true);
      return;
    }
    void navigator.locks.request(UNITY_LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
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
