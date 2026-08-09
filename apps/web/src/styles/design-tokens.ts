export const designTokens = Object.freeze({
  surface: "#f7f9fb",
  surfaceContainerLowest: "#ffffff",
  surfaceContainerLow: "#f2f4f6",
  surfaceContainer: "#eceef0",
  surfaceContainerHigh: "#e6e8ea",
  onSurface: "#191c1e",
  onSurfaceVariant: "#45464d",
  primary: "#000000",
  onPrimary: "#ffffff",
  secondary: "#006c49",
  error: "#ba1a1a",
  outline: "#76777d",
  outlineVariant: "#c6c6cd",
  statusSetup: "#64748b",
  statusArmed: "#10b981",
  statusRecovery: "#f59e0b",
  statusAlert: "#ea580c",
  statusCritical: "#dc2626",
  borderSubtle: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
});

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!match) throw new Error(`Unsupported color: ${hex}`);
  return (
    0.2126 * channel(Number.parseInt(match[1] ?? "00", 16)) +
    0.7152 * channel(Number.parseInt(match[2] ?? "00", 16)) +
    0.0722 * channel(Number.parseInt(match[3] ?? "00", 16))
  );
}

export function minimumContrastRatio(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}
