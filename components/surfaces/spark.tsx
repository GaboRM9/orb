/** A tiny trend line, stretched to its box; shared by the currency and loan views. */
export function Spark({ values, className = "h-12 w-full", label }: { values: number[]; className?: string; label: string }) {
  if (values.length < 2) return null;
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  const y = (v: number) => (hi === lo ? 15 : 28 - ((v - lo) / (hi - lo)) * 26);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`text-accent ${className}`} role="img" aria-label={label}>
      <polygon points={`0,30 ${pts} 100,30`} fill="currentColor" opacity="0.08" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
