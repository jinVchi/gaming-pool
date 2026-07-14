"use client";

import { useEffect, useRef, useState } from "react";

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL ?? "http://localhost:8787";

interface UnityInstance {
  Quit: () => Promise<void>;
}

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, unknown>,
    ) => Promise<UnityInstance>;
    __gamingPoolPlayer?: { playerId: string; displayName: string };
  }
}

export function UnityLoader({
  slug,
  playerId,
  displayName,
}: {
  slug: string;
  playerId: string;
  displayName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unityInstance: UnityInstance | null = null;
    let cancelled = false;

    // Unity reads this through the WebGL jslib bridge (GPGetPlayerIdentity)
    // instead of inventing its own identity — must be set before the build
    // boots.
    window.__gamingPoolPlayer = { playerId, displayName };

    // Unity's WebGL output names the sub-files after the build's output folder
    // and nests them in a Build/ subfolder. Convention: each game is built into
    // unity/{slug}/Build, so the files land at unity/{slug}/Build/Build/Build.*
    // (served by the CDN at {slug}/Build/Build/Build.*).
    const buildUrl = `${CDN_URL}/${slug}/Build/Build`;
    const buildName = "Build";
    const script = document.createElement("script");
    script.src = `${buildUrl}/${buildName}.loader.js`;

    script.onload = async () => {
      if (cancelled || !canvasRef.current || !window.createUnityInstance) return;
      try {
        unityInstance = await window.createUnityInstance(canvasRef.current, {
          dataUrl: `${buildUrl}/${buildName}.data`,
          frameworkUrl: `${buildUrl}/${buildName}.framework.js`,
          codeUrl: `${buildUrl}/${buildName}.wasm`,
          companyName: "Gaming Pool",
          productName: slug,
          productVersion: "1.0",
        });
      } catch (err) {
        if (!cancelled) setError(`Failed to start ${slug}: ${(err as Error)?.message ?? String(err)}`);
      }
    };
    script.onerror = () => {
      if (!cancelled) {
        setError(`Build not found at ${buildUrl} — build unity/${slug} into a folder named Build.`);
      }
    };
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      document.body.removeChild(script);
      void unityInstance?.Quit();
    };
  }, [slug, playerId, displayName]);

  if (error) {
    return <p className="game-status" role="alert">{error}</p>;
  }

  // Unity 6's loader requires the canvas to have an HTML id, and reads its CSS
  // size to build the framebuffer — without explicit CSS dimensions the
  // framebuffer attachment comes out zero-sized.
  return (
    <canvas
      ref={canvasRef}
      id="unity-canvas"
      className="game-canvas"
      width={960}
      height={600}
      style={{ width: 960, height: 600 }}
    />
  );
}
