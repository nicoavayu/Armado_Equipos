import React, { forwardRef } from 'react';
import logo from '../../Logo.png';

// Shareable "RESUMEN DEL PARTIDO" piece. Social-first: fixed 9:16 canvas
// (Instagram stories / WhatsApp status) on the same visual base as
// ShareableTeamsCard (radial violet backdrop, Bebas/Oswald, neon accents).
// Instead of listing rosters it leads with the result and an adaptive mosaic
// of award blocks (1 hero → 2 stacked → 1+2 → 2x2), so the plaque looks
// designed no matter how many awards the match produced. Consumes the
// view-model from buildMatchSummaryShareCardData(); empty sections are omitted.
export const SUMMARY_CARD_WIDTH = 1080;
export const SUMMARY_CARD_HEIGHT = 1920;

const VIOLET = '#8b5cff';
const PINK = '#ec007d';
const GOLD = '#f5c451';

const headFont = "'Bebas Neue', 'Oswald', sans-serif";
const bodyFont = "'Oswald', 'Inter', sans-serif";

const hexToRgba = (hex, alpha) => {
  const token = String(hex || '').replace('#', '');
  if (token.length !== 6) return `rgba(139,92,255,${alpha})`;
  const r = parseInt(token.slice(0, 2), 16);
  const g = parseInt(token.slice(2, 4), 16);
  const b = parseInt(token.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const MetaChip = ({ children }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '9px 22px',
      borderRadius: 999,
      border: '1.5px solid rgba(148,134,255,0.32)',
      background: 'rgba(20,16,41,0.6)',
      color: 'rgba(242,246,255,0.92)',
      fontFamily: bodyFont,
      fontWeight: 600,
      fontSize: 28,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
      maxWidth: 880,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {children}
  </span>
);

// Player photo with a branded initial disc as fallback when no photo exists.
const AvatarDisc = ({ award, size }) => (
  <div
    style={{
      position: 'relative',
      width: size,
      height: size,
      flex: '0 0 auto',
      borderRadius: '50%',
      overflow: 'hidden',
      border: `4px solid ${hexToRgba(award.color, 0.75)}`,
      boxShadow: `0 0 ${Math.round(size / 5)}px ${hexToRgba(award.color, 0.35)}`,
      background: 'linear-gradient(160deg, rgba(139,92,255,0.4), rgba(20,16,41,0.9))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    {award.playerAvatarUrl ? (
      <img
        src={award.playerAvatarUrl}
        alt={award.playerName}
        crossOrigin="anonymous"
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : (
      <span
        style={{
          color: '#ffffff',
          fontFamily: headFont,
          fontSize: Math.round(size * 0.46),
          lineHeight: 1,
          textShadow: '0 0 18px rgba(139,92,255,0.6)',
        }}
      >
        {award.playerInitial || '?'}
      </span>
    )}
  </div>
);

const awardPanelBase = (award) => ({
  position: 'relative',
  display: 'flex',
  boxSizing: 'border-box',
  borderRadius: 30,
  border: `2px solid ${hexToRgba(award.color, 0.45)}`,
  background: `radial-gradient(420px 200px at 50% -20%, ${hexToRgba(award.color, 0.14)}, transparent 70%), linear-gradient(168deg, rgba(40,31,84,0.66), rgba(16,12,33,0.9))`,
  boxShadow: `0 0 34px ${hexToRgba(award.color, 0.18)}, inset 0 1px 0 rgba(255,255,255,0.06)`,
});

const AwardLabel = ({ award, fontSize }) => (
  <span
    style={{
      color: hexToRgba(award.color, 0.95),
      fontFamily: headFont,
      fontSize,
      lineHeight: 1,
      letterSpacing: '0.1em',
      whiteSpace: 'nowrap',
      textShadow: `0 0 20px ${hexToRgba(award.color, 0.45)}`,
    }}
  >
    {award.label}
  </span>
);

const AwardName = ({ award, fontSize }) => (
  <span
    style={{
      maxWidth: '100%',
      color: '#ffffff',
      fontFamily: bodyFont,
      fontWeight: 700,
      fontSize,
      lineHeight: 1.08,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {award.playerName}
  </span>
);

// Single award → full-width protagonist block with a big photo and lots of air.
const AwardHero = ({ award, compact = false }) => (
  <div
    style={{
      ...awardPanelBase(award),
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: compact ? 20 : 26,
      padding: compact ? '40px 48px 44px' : '56px 56px 60px',
      width: '100%',
    }}
  >
    <div style={{ position: 'relative' }}>
      <AvatarDisc award={award} size={compact ? 210 : 260} />
      <img
        src={award.icon}
        alt=""
        width={compact ? 84 : 96}
        height={compact ? 84 : 96}
        draggable={false}
        style={{
          position: 'absolute',
          right: compact ? -18 : -22,
          bottom: compact ? -10 : -12,
          filter: `drop-shadow(0 0 18px ${award.color})`,
        }}
      />
    </div>
    <AwardLabel award={award} fontSize={compact ? 46 : 54} />
    <AwardName award={award} fontSize={compact ? 52 : 62} />
  </div>
);

// Two awards → stacked horizontal blocks that share the stage evenly.
const AwardRowBlock = ({ award }) => (
  <div
    style={{
      ...awardPanelBase(award),
      flexDirection: 'row',
      alignItems: 'center',
      gap: 34,
      padding: '34px 42px',
      width: '100%',
    }}
  >
    <AvatarDisc award={award} size={160} />
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AwardLabel award={award} fontSize={42} />
      <AwardName award={award} fontSize={52} />
    </div>
    <img
      src={award.icon}
      alt=""
      width={92}
      height={92}
      draggable={false}
      style={{ flex: '0 0 auto', filter: `drop-shadow(0 0 16px ${award.color})` }}
    />
  </div>
);

// Grid tile used for the 3rd/4th blocks (and the 2x2 layout).
const AwardTile = ({ award }) => (
  <div
    style={{
      ...awardPanelBase(award),
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 16,
      padding: '30px 26px 32px',
      flex: '1 1 0',
      minWidth: 0,
    }}
  >
    <div style={{ position: 'relative' }}>
      <AvatarDisc award={award} size={140} />
      <img
        src={award.icon}
        alt=""
        width={60}
        height={60}
        draggable={false}
        style={{
          position: 'absolute',
          right: -12,
          bottom: -6,
          filter: `drop-shadow(0 0 14px ${award.color})`,
        }}
      />
    </div>
    <AwardLabel award={award} fontSize={34} />
    <AwardName award={award} fontSize={40} />
  </div>
);

// Adaptive mosaic: the composition is designed per count so the plaque never
// looks like an incomplete grid.
const AwardsMosaic = ({ awards }) => {
  if (awards.length === 1) {
    return <AwardHero award={awards[0]} />;
  }

  if (awards.length === 2) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26, width: '100%' }}>
        <AwardRowBlock award={awards[0]} />
        <AwardRowBlock award={awards[1]} />
      </div>
    );
  }

  if (awards.length === 3) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26, width: '100%' }}>
        <AwardHero award={awards[0]} compact />
        <div style={{ display: 'flex', gap: 26 }}>
          <AwardTile award={awards[1]} />
          <AwardTile award={awards[2]} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, width: '100%' }}>
      <div style={{ display: 'flex', gap: 26 }}>
        <AwardTile award={awards[0]} />
        <AwardTile award={awards[1]} />
      </div>
      <div style={{ display: 'flex', gap: 26 }}>
        <AwardTile award={awards[2]} />
        <AwardTile award={awards[3]} />
      </div>
    </div>
  );
};

const ResultBlock = ({ result }) => (
  <div
    style={{
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 16,
      padding: '34px 28px',
      borderRadius: 28,
      border: `2px solid ${result.outcome === 'winner' ? 'rgba(245,196,81,0.5)' : 'rgba(148,134,255,0.34)'}`,
      background: result.outcome === 'winner'
        ? 'radial-gradient(460px 180px at 50% -40%, rgba(245,196,81,0.18), transparent 70%), linear-gradient(168deg, rgba(40,31,84,0.62), rgba(16,12,33,0.85))'
        : 'linear-gradient(168deg, rgba(40,31,84,0.62), rgba(16,12,33,0.85))',
    }}
  >
    <span
      style={{
        color: 'rgba(244,246,255,0.55)',
        fontFamily: bodyFont,
        fontWeight: 700,
        fontSize: 24,
        letterSpacing: '0.3em',
      }}
    >
      RESULTADO
    </span>
    <span
      style={{
        color: result.outcome === 'winner' ? GOLD : '#ffffff',
        fontFamily: headFont,
        fontSize: 88,
        lineHeight: 1,
        letterSpacing: '0.03em',
        textShadow: result.outcome === 'winner'
          ? '0 0 30px rgba(245,196,81,0.45)'
          : '0 0 24px rgba(139,92,255,0.5)',
        whiteSpace: 'nowrap',
      }}
    >
      {result.label}
    </span>
    {result.scoreline ? (
      <span
        style={{
          padding: '10px 26px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(12,10,29,0.7)',
          color: '#ffffff',
          fontFamily: headFont,
          fontSize: 52,
          lineHeight: 1,
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
        }}
      >
        {result.scoreline}
      </span>
    ) : null}
  </div>
);

const ShareableMatchSummaryCard = forwardRef(({ data }, ref) => {
  if (!data) return null;
  const hasMeta = Boolean(data.format || data.dateTime || data.venue);
  const awards = (data.awards || []).slice(0, 4);

  return (
    <div
      ref={ref}
      style={{
        width: SUMMARY_CARD_WIDTH,
        height: SUMMARY_CARD_HEIGHT,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '76px 72px 56px',
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(130% 80% at 50% 0%, #221651 0%, #160e36 48%, #0d0820 100%)',
        fontFamily: bodyFont,
      }}
    >
      {/* Ambient glows — same base as the teams share piece */}
      <div
        style={{
          position: 'absolute', top: -180, left: -120, width: 560, height: 560,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,255,0.28), transparent 70%)',
        }}
      />
      <div
        style={{
          position: 'absolute', bottom: -160, right: -120, width: 520, height: 520,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,0,125,0.18), transparent 70%)',
        }}
      />

      {/* Header */}
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 26 }}>
        <img
          src={logo}
          alt="Arma2"
          crossOrigin="anonymous"
          style={{ height: 64, width: 'auto', objectFit: 'contain', marginBottom: 22 }}
        />
        <div
          style={{
            color: '#ffffff',
            fontFamily: headFont,
            fontSize: 98,
            lineHeight: 0.96,
            letterSpacing: '0.02em',
            textShadow: '0 0 36px rgba(139,92,255,0.55)',
          }}
        >
          {data.title}
        </div>
        {data.matchName ? (
          <div
            style={{
              marginTop: 18,
              color: '#cfc4ff',
              fontFamily: bodyFont,
              fontWeight: 700,
              fontSize: 44,
              lineHeight: 1.1,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {data.matchName}
          </div>
        ) : null}
        <div
          style={{
            margin: '22px auto 0',
            width: 380,
            height: 4,
            borderRadius: 999,
            background: `linear-gradient(90deg, transparent, ${VIOLET} 35%, ${PINK} 70%, transparent)`,
          }}
        />
      </div>

      {/* Meta */}
      {hasMeta ? (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 14,
            marginBottom: 30,
          }}
        >
          {data.format ? <MetaChip>{data.format}</MetaChip> : null}
          {data.dateTime ? <MetaChip>{data.dateTime}</MetaChip> : null}
          {data.venue ? <MetaChip>{data.venue}</MetaChip> : null}
        </div>
      ) : null}

      {/* Result — only when a real winner/draw exists */}
      {data.result ? (
        <div style={{ position: 'relative', marginBottom: 30 }}>
          <ResultBlock result={data.result} />
        </div>
      ) : null}

      {/* Awards mosaic — centered in the remaining stage */}
      <div
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {awards.length > 0 ? <AwardsMosaic awards={awards} /> : null}
      </div>

      {/* Footer */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          marginTop: 36,
        }}
      >
        <img
          src={logo}
          alt="Arma2"
          crossOrigin="anonymous"
          style={{
            height: 56,
            width: 'auto',
            objectFit: 'contain',
            opacity: 0.6,
          }}
        />
        <div
          style={{
            color: 'rgba(176,160,255,0.55)',
            fontFamily: bodyFont,
            fontWeight: 600,
            fontSize: 26,
            letterSpacing: '0.18em',
          }}
        >
          {data.website}
        </div>
      </div>
    </div>
  );
});

ShareableMatchSummaryCard.displayName = 'ShareableMatchSummaryCard';

export default ShareableMatchSummaryCard;
