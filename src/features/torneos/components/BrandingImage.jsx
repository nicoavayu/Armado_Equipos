import React, { useMemo, useState } from 'react';
import { resolveBrandingAssetCandidates } from '../domain/brandingAssets';

// First letters of the first two words. When the name ends in a number ("QA Equipo 1",
// "QA Equipo 2") the number replaces the second letter, so numbered names stay distinct.
export function initials(value = '') {
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'A2';
  const last = words[words.length - 1];
  if (words.length > 1 && /^\d+$/.test(last)) return `${words[0][0]}${last.slice(0, 2)}`.toUpperCase();
  return words.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function BrandingImage({
  kind,
  path = null,
  fallbackPath = null,
  name = '',
  className = '',
  imageClassName = '',
  style,
  decorative = true,
  loading = 'lazy',
  // Rendered instead of the initials once no candidate is left (none resolved
  // or every one failed to load).
  fallback = null,
}) {
  const candidates = useMemo(() => resolveBrandingAssetCandidates({
    kind,
    path,
    fallbackPath,
  }), [fallbackPath, kind, path]);
  // The failed-candidate cursor belongs to one candidate list: a new list starts
  // over at 0. Derived during render instead of reset by an effect, because a
  // mount effect that has not flushed yet when an early onError lands would
  // overwrite that +1 with 0 and pin the broken first candidate.
  const candidateKey = candidates.join('|');
  const [cursor, setCursor] = useState({ key: candidateKey, index: 0 });
  const candidateIndex = cursor.key === candidateKey ? cursor.index : 0;

  const src = candidates[candidateIndex] || null;
  if (!src && fallback) return fallback;
  return (
    <span
      className={className}
      style={style}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={decorative ? '' : name}
          loading={loading}
          className={imageClassName}
          onError={() => setCursor((current) => ({
            key: candidateKey,
            index: (current.key === candidateKey ? current.index : 0) + 1,
          }))}
        />
      ) : initials(name)}
    </span>
  );
}
