export function SebasSeal({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="Selo do Sebas"
    >
      <circle cx="24" cy="24" r="22" stroke="var(--color-gold-dim)" strokeWidth="1" />
      <circle cx="24" cy="24" r="18.5" stroke="var(--color-gold)" strokeWidth="1" />
      <line x1="24" y1="3" x2="24" y2="7" stroke="var(--color-gold-dim)" strokeWidth="1" />
      <line x1="24" y1="41" x2="24" y2="45" stroke="var(--color-gold-dim)" strokeWidth="1" />
      <line x1="3" y1="24" x2="7" y2="24" stroke="var(--color-gold-dim)" strokeWidth="1" />
      <line x1="41" y1="24" x2="45" y2="24" stroke="var(--color-gold-dim)" strokeWidth="1" />
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-gold-bright)"
        fontFamily="var(--font-display)"
        fontWeight="800"
        fontSize="21"
      >
        S
      </text>
    </svg>
  );
}
