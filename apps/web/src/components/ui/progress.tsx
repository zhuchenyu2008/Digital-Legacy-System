export function Progress({ label, max, value }: Readonly<{ label: string; max: number; value: number }>) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value} className="dls-progress" role="progressbar">
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}
