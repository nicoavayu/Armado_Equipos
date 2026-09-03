import React, { useLayoutEffect, useRef } from 'react';
import Heritage45 from './generated/Heritage45';
import Heritage916 from './generated/Heritage916';
import Street45 from './generated/Street45';
import Street916 from './generated/Street916';
import Scoreboard45 from './generated/Scoreboard45';
import Scoreboard916 from './generated/Scoreboard916';
import Editorial45 from './generated/Editorial45';
import Editorial916 from './generated/Editorial916';
import { applyPremiumLayoutHardening } from './premiumLayoutHardening';
import { resolveEditorialStandingsPagination } from './premiumPagination';
import { PremiumRenderContext } from './shared/PremiumPrimitives';

export const PREMIUM_DOM_LAYOUTS = Object.freeze({
  'heritage:portrait': Heritage45,
  'heritage:story': Heritage916,
  'street:portrait': Street45,
  'street:story': Street916,
  'scoreboard:portrait': Scoreboard45,
  'scoreboard:story': Scoreboard916,
  'editorial:portrait': Editorial45,
  'editorial:story': Editorial916,
});

function PremiumHardeningEffect({ snapshot, editorial, themeId, formatId, pagination }) {
  const markerRef = useRef(null);
  useLayoutEffect(() => {
    const root = markerRef.current?.previousElementSibling;
    applyPremiumLayoutHardening(root, {
      snapshot, editorial, themeId, formatId, pagination,
    });
  }, [editorial, formatId, pagination, snapshot, themeId]);
  return <span ref={markerRef} data-premium-hardening="v1" style={{ display: 'none' }} />;
}

export default function PremiumRenderer({ theme, editorial, ...props }) {
  const themeId = typeof theme === 'string' ? theme : theme?.id;
  const formatId = editorial?.format === 'story' ? 'story' : 'portrait';
  const Layout = PREMIUM_DOM_LAYOUTS[`${themeId}:${formatId}`];
  if (!Layout) throw new Error(`PREMIUM_V2_LAYOUT_MISSING: ${themeId}/${formatId}`);
  const pagination = resolveEditorialStandingsPagination(props.snapshot, editorial, themeId);
  const renderSnapshot = pagination.snapshot;
  const candidates = renderSnapshot?.official?.candidates || [];
  const selectedId = editorial?.selection?.[0];
  const selectedPlayer = candidates.find((candidate) => (
    (candidate.rosterPlayerId || candidate.participantId) === selectedId
  )) || props.content?.selectedPlayer || candidates[0] || null;
  const figureInitials = String(selectedPlayer?.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <PremiumRenderContext.Provider value={{
      piece: renderSnapshot?.piece,
      themeId,
      formatId,
      figureInitials,
    }}>
      <Layout {...props} snapshot={renderSnapshot} editorial={editorial} />
      <PremiumHardeningEffect
        snapshot={renderSnapshot}
        editorial={editorial}
        themeId={themeId}
        formatId={formatId}
        pagination={pagination}
      />
    </PremiumRenderContext.Provider>
  );
}
