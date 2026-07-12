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
  }
}

export function UnityLoader({ slug }: { slug: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unityInstance: UnityInstance | null = null;
    let cancelled = false;

    const buildUrl = `${CDN_URL}/${slug}/Build`;
    const script = document.createElement("script");
    script.src = `${buildUrl}/${slug}.loader.js`;

    script.onload = async () => {
      if (cancelled || !canvasRef.current || !window.createUnityInstance) return;
      try {
        unityInstance = await window.createUnityInstance(canvasRef.current, {
          dataUrl: `${buildUrl}/${slug}.data`,
          frameworkUrl: `${buildUrl}/${slug}.framework.js`,
          codeUrl: `${buildUrl}/${slug}.wasm`,
        });
      } catch (err) {
        if (!cancelled) setError(`Failed to start ${slug}: ${(err as Error).message}`);
      }
    };
    script.onerror = () => {
      if (!cancelled) {
        setError(`Build not found at ${buildUrl} — has it been uploaded to unity/${slug}/Build?`);
      }
    };
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      document.body.removeChild(script);
      void unityInstance?.Quit();
    };
  }, [slug]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return <canvas ref={canvasRef} width={960} height={600} />;
}
