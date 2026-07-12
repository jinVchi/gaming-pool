"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const UnityLoader = dynamic(() => import("./UnityLoader").then((m) => m.UnityLoader), {
  ssr: false,
});

export function PlayShell({ slug }: { slug: string }) {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div>
        <button type="button" className="play-button" onClick={() => setStarted(true)}>
          Play
        </button>
      </div>
    );
  }

  return <UnityLoader slug={slug} />;
}
