// The two speech-bubble characters. Drawn facing right; `flip` mirrors them.

export type Mood = 'angry' | 'wide' | 'worried' | 'dots' | 'happy' | 'calm';

const INK = 'var(--ink)';

function Face({ mood }: { mood: Mood }) {
  switch (mood) {
    case 'angry':
      return (
        <g stroke={INK} strokeWidth="4" strokeLinecap="round" fill={INK}>
          <path d="M56 36 L68 42" fill="none" />
          <path d="M86 36 L74 42" fill="none" />
          <circle cx="64" cy="49" r="3.6" stroke="none" />
          <circle cx="78" cy="49" r="3.6" stroke="none" />
        </g>
      );
    case 'wide':
    case 'worried':
      return (
        <g>
          <ellipse cx="64" cy="48" rx="7" ry="8.5" fill="#fff" stroke={INK} strokeWidth="3" />
          <ellipse cx="80" cy="48" rx="7" ry="8.5" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx="66.5" cy="49" r="3.8" fill={INK} />
          <circle cx="82.5" cy="49" r="3.8" fill={INK} />
          {mood === 'worried' && (
            <g stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none">
              <path d="M58 35 Q63 31 69 33" />
              <path d="M75 33 Q81 31 86 35" />
            </g>
          )}
        </g>
      );
    case 'dots':
      return (
        <g fill={INK}>
          <circle className="dot d1" cx="56" cy="50" r="4.2" />
          <circle className="dot d2" cx="70" cy="50" r="4.2" />
          <circle className="dot d3" cx="84" cy="50" r="4.2" />
        </g>
      );
    case 'happy':
      return (
        <g stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none">
          <path d="M58 49 Q63 42 68 49" />
          <path d="M74 49 Q79 42 84 49" />
          <path d="M64 60 Q72 67 80 60" />
        </g>
      );
    case 'calm':
      return (
        <g fill={INK}>
          <circle cx="64" cy="48" r="4" />
          <circle cx="79" cy="48" r="4" />
          <path d="M65 60 Q72 64 79 60" stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </g>
      );
  }
}

export function Blob({
  mood,
  tone = 'light',
  flip = false,
  size = 120,
  lines = false,
  className = '',
}: {
  mood: Mood;
  tone?: 'light' | 'dark';
  flip?: boolean;
  size?: number;
  lines?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`blob ${className}`}
      width={size}
      height={size * (100 / 124)}
      viewBox="-4 -4 124 100"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {lines && (
        <g className="motion-lines" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
          <path d="M14 14 L6 6" />
          <path d="M8 28 L-2 24" />
          <path d="M10 78 L2 86" />
        </g>
      )}
      <path
        d="M22 28 C 32 6, 84 4, 96 26 C 101 36, 101 48, 99 55 L 116 64 L 96 69 C 86 88, 42 92, 26 80 C 8 68, 10 42, 22 28 Z"
        fill={tone === 'light' ? 'var(--mint)' : 'var(--green)'}
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <Face mood={mood} />
    </svg>
  );
}

/** Two blobs facing each other, in one of the three "motion moments". */
export function Pair({ moment, size = 130 }: { moment: 'arrive' | 'listen' | 'connect'; size?: number }) {
  const moods: Record<typeof moment, [Mood, Mood]> = {
    arrive: ['angry', 'wide'],
    listen: ['worried', 'dots'],
    connect: ['happy', 'happy'],
  };
  const [a, b] = moods[moment];
  return (
    <div className={`pair pair-${moment}`} role="img" aria-label="Two speech bubbles">
      <div className="pair-left">
        <Blob mood={a} tone="light" size={size} lines={moment !== 'listen'} />
      </div>
      {moment === 'connect' && (
        <div className="pair-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M5 12.5 L10 17 L19 7" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <div className="pair-right">
        <Blob mood={b} tone="dark" flip size={size} lines={moment !== 'listen'} />
      </div>
    </div>
  );
}
