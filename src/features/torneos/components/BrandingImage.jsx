import React, { useEffect, useMemo, useState } from 'react';
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
}) {
  const candidates = useMemo(() => resolveBrandingAssetCandidates({
    kind,
    path,
    fallbackPath,
  }), [fallbackPath, kind, path]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => setCandidateIndex(0), [candidates.join('|')]);

  const src = candidates[candidateIndex] || null;
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
          onError={() => setCandidateIndex((current) => current + 1)}
        />
      ) : initials(name)}
    </span>
  );
}
