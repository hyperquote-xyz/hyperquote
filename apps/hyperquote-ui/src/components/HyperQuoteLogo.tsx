/**
 * HyperQuote Logo — V4D (Bottom Flows, Top Ends)
 *
 * Asymmetric tapered ribbons:
 *   - Bottom ribbon flows fully right→left (winning maker quote → taker)
 *   - Top ribbon tapers to a point (competing quote, not selected)
 *
 * Props:
 *   size: pixel dimension (square)
 *   className: optional wrapper class
 */

interface HyperQuoteLogoProps {
  size?: number;
  className?: string;
}

export function HyperQuoteLogo({ size = 36, className }: HyperQuoteLogoProps) {
  const id = `hq-logo-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background */}
      <rect width="512" height="512" rx="112" fill="#0F1722" />

      {/* Subtle glow */}
      <radialGradient id={`${id}-glow`} cx="52%" cy="52%" r="38%">
        <stop offset="0%" stopColor="#2BB8A4" stopOpacity="0.09" />
        <stop offset="100%" stopColor="#2BB8A4" stopOpacity="0" />
      </radialGradient>
      <circle cx="266" cy="266" r="200" fill={`url(#${id}-glow)`} />

      {/* Top ribbon gradient — fades out (competing quote) */}
      <linearGradient id={`${id}-top`} x1="190" y1="140" x2="412" y2="80">
        <stop offset="0%" stopColor="#40E8C8" stopOpacity="0.35" />
        <stop offset="50%" stopColor="#40E8C8" stopOpacity="0.7" />
        <stop offset="100%" stopColor="#40E8C8" />
      </linearGradient>

      {/* Bottom ribbon gradient — full flow (winning quote) */}
      <linearGradient id={`${id}-bot`} x1="100" y1="300" x2="412" y2="420">
        <stop offset="0%" stopColor="#40E8C8" />
        <stop offset="50%" stopColor="#34D9B8" />
        <stop offset="100%" stopColor="#2BB8A4" />
      </linearGradient>

      {/* Top ribbon — tapers to sharp point (competing quote) */}
      <path
        d="M190 240
           C 240 236, 280 210, 310 170
           C 340 132, 370 98, 412 98
           L 412 144
           C 370 144, 340 174, 310 208
           C 280 244, 240 258, 200 256
           Z"
        fill={`url(#${id}-top)`}
      />

      {/* Bottom ribbon — full flow right→left (winning quote delivers liquidity) */}
      <path
        d="M100 252
           C 150 252, 190 260, 230 268
           C 260 274, 280 294, 310 334
           C 340 374, 370 414, 412 414
           L 412 460
           C 370 460, 340 420, 310 380
           C 280 340, 260 304, 230 290
           C 190 278, 150 268, 100 268
           Z"
        fill={`url(#${id}-bot)`}
      />
    </svg>
  );
}
