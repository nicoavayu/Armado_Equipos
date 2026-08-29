import React, { useEffect, useMemo, useState } from 'react';
import { resolveBrandingAssetCandidates } from '../domain/brandingAssets';

function initials(value = '') {
  return String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'A2';
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
