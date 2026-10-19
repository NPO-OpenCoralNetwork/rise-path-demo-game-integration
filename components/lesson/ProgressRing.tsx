import React from 'react';
import { Check } from 'lucide-react';

/**
 * Reading progress as a ring with the number inside (colour is never the only cue). The visible
 * label is the bare number (the "%" lives in aria-label) so "100" fits; at 100 it shows a check.
 */
export function ProgressRing({ pct, label, size = 40 }: { pct: number; label: string; size?: number }) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="rp-ring"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="rp-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="rp-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="rp-ring-label tabular" aria-hidden="true">
        {value >= 100 ? <Check size={16} strokeWidth={3} /> : value}
      </span>
    </div>
  );
}
