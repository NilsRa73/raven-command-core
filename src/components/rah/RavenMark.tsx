export function RavenMark({ className = "", size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="RAH raven emblem"
    >
      <defs>
        <linearGradient id="rah-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.94 0.16 88)" />
          <stop offset="1" stopColor="oklch(0.65 0.12 70)" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="none" stroke="url(#rah-gold)" strokeWidth="1.5" opacity="0.6" />
      <path
        d="M14 40c6-2 10-6 12-12 2 8 8 12 16 14-6 4-14 4-20 2-2 2-6 2-8-4z"
        fill="url(#rah-gold)"
      />
      <circle cx="42" cy="30" r="1.6" fill="oklch(0.14 0 0)" />
      <path d="M44 30l6-2" stroke="url(#rah-gold)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 50c8 4 20 4 28-2" stroke="url(#rah-gold)" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}