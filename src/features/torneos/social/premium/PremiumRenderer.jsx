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
import { figureDisplayName } from './premiumDataAdapter';
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

function PremiumHardeningEffect({
  snapshot, editorial, themeId, formatId, pagination, figureName, figureTeamName,
}) {
  const markerRef = useRef(null);
  useLayoutEffect(() => {
    const root = markerRef.current?.previousElementSibling;
    applyPremiumLayoutHardening(root, {
      snapshot, editorial, themeId, formatId, pagination, figureName, figureTeamName,
    });
  }, [editorial, figureName, figureTeamName, formatId, pagination, snapshot, themeId]);
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
  // Without a photo the story Figura shows the first name, whole, like the feed (fitted to its frame by the hardening).
  const figureName = figureDisplayName(selectedPlayer?.name, themeId);
  const figureTeam = selectedPlayer?.team || {};
  const figureTeamName = String(figureTeam.name || figureTeam.teamName || figureTeam.shortName || '').trim();
  return (
    <PremiumRenderContext.Provider value={{
      piece: renderSnapshot?.piece,
      themeId,
      formatId,
      figureInitials: figureName,
    }}>
      {/* An Editorial standings page holds 15 rows; "N EQUIPOS" counts the whole table. */}
      <Layout {...props} snapshot={renderSnapshot} editorial={editorial} standingsTotal={pagination.totalRows} />
      <PremiumHardeningEffect
        snapshot={renderSnapshot}
        editorial={editorial}
        themeId={themeId}
        formatId={formatId}
        pagination={pagination}
        figureName={figureName}
        figureTeamName={figureTeamName}
      />
    </PremiumRenderContext.Provider>
  );
}
