"use client";

import { useState } from "react";
import { Icon } from "../../components/icons/icon";

export function CopyPublicWill() {
  const [copied, setCopied] = useState(false);

  async function copyWill() {
    const text = document.querySelector<HTMLElement>(".dls-will-body")?.innerText.trim() ?? "";
    if (text.length === 0) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <button aria-label="复制遗书正文" className="dls-copy-will" onClick={copyWill} type="button">
      <Icon name="content_copy" size={18} />
      <span>{copied ? "已复制" : "Copy Raw"}</span>
    </button>
  );
}
