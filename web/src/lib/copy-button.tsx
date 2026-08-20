"use client";

import { useEffect, useRef, useState } from "react";

// navigator.clipboard only exists in a secure context, and plenty of self-hosted
// installs sit on plain HTTP behind a LAN proxy — so fall back to the deprecated
// execCommand path there instead of silently doing nothing.
async function writeClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied, or the document wasn't focused — try the fallback
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

const LABEL = { idle: "Copy for LLM", ok: "Copied", fail: "Copy failed" } as const;

export function CopyForLlm({ text, title }: { text: string; title?: string }) {
  const [state, setState] = useState<keyof typeof LABEL>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={`btn-copy ${state}`}
      title={title ?? "Copy a markdown summary to paste into an LLM"}
      onClick={async () => {
        const ok = await writeClipboard(text);
        setState(ok ? "ok" : "fail");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2000);
      }}
    >
      {LABEL[state]}
    </button>
  );
}
