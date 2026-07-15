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

export function PlayShell({ slug }: { slug: string }) {
  const { data: session, isPending } = useSession();
  const [started, setStarted] = useState(false);
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false);

  useEffect(() => {
    // Warn up front if a game is already running in another tab.
    if (!("locks" in navigator)) return;
    void navigator.locks.query().then((state) => {
      if (state.held?.some((lock) => lock.name === UNITY_LOCK_NAME)) {
        setLockedByOtherTab(true);
      }
    });
  }, []);

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

  const identity = session?.user
    ? { playerId: session.user.id, displayName: session.user.name || "Player" }
    : getGuestIdentity();

  return (
    <div className="play-shell">
      <UnityLoader slug={slug} playerId={identity.playerId} displayName={identity.displayName} />
    </div>
  );
}
