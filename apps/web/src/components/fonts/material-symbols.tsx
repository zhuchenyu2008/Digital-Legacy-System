"use client";

import { useEffect } from "react";

const MATERIAL_SYMBOLS_QUERY = '400 24px "Material Symbols Outlined"';

type MaterialFontSet = Readonly<{
  check(query: string): boolean;
  load(query: string): Promise<unknown>;
}>;

type MaterialFontRoot = Readonly<{
  classList: Readonly<{ add(value: string): void }>;
}>;

export async function activateMaterialSymbols(
  root: MaterialFontRoot,
  fonts: MaterialFontSet,
): Promise<void> {
  try {
    await fonts.load(MATERIAL_SYMBOLS_QUERY);
    if (fonts.check(MATERIAL_SYMBOLS_QUERY)) {
      root.classList.add("dls-material-symbols-ready");
    }
  } catch {
    // The local SVG remains visible when the remote font is unavailable.
  }
}

export function MaterialSymbolsRuntime() {
  useEffect(() => {
    void activateMaterialSymbols(document.documentElement, document.fonts);
  }, []);

  return null;
}
