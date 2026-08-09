"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";

export function CopyRequestId({ requestId }: Readonly<{ requestId: string }>) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button aria-label="复制请求编号" onClick={copy} tone="secondary">
      {copied ? "已复制" : "复制编号"}
    </Button>
  );
}
