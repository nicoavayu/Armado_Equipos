import React, { forwardRef } from 'react';
import logo from '../../Logo.png';

// Fixed export width — vertical-friendly for WhatsApp / stories. Height is
// driven by content so the card hugs the players with no wasted space.
export const SHARE_CARD_WIDTH = 1080;

const VIOLET = '#8b5cff';
const BLUE = '#4ea8ff';
const PINK = '#ec007d';

// Team accents: violet for A, blue for B. Kept on-brand with the app palette.
const TEAM_ACCENTS = {
  a: { stroke: 'rgba(139,92,255,0.55)', glow: 'rgba(139,92,255,0.30)', bar: VIOLET, chip: 'rgba(139,92,255,0.18)' },
  b: { stroke: 'rgba(78,168,255,0.55)', glow: 'rgba(78,168,255,0.28)', bar: BLUE, chip: 'rgba(78,168,255,0.16)' },
};

// Type scale shrinks as squads grow. Containers hug content either way, so we
// keep names as large as possible while staying tidy for F11.
const sizingForSquad = (maxTeamSize) => {
  if (maxTeamSize <= 5) return { name: 46, num: 38, rowH: 80, pad: 24 };
  if (maxTeamSize <= 7) return { name: 41, num: 34, rowH: 70, pad: 20 };
  if (maxTeamSize <= 9) return { name: 36, num: 30, rowH: 60, pad: 17 };
  return { name: 31, num: 27, rowH: 52, pad: 15 };
};

const headFont = "'Bebas Neue', 'Oswald', sans-serif";
const bodyFont = "'Oswald', 'Inter', sans-serif";

const MetaChip = ({ children }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '10px 22px',
      borderRadius: 999,
      border: '1.5px solid rgba(148,134,255,0.32)',
      background: 'rgba(20,16,41,0.6)',
      color: 'rgba(242,246,255,0.92)',
      fontFamily: bodyFont,
      fontWeight: 600,
      fontSize: 30,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
      // Hard guard: a long value must never push past the card margins.
      maxWidth: 900,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {children}
  </span>
);

// One player = a distinguished, separated row (mirrors the recent-activity feed:
// zebra background + hairline divider between rows).
const PlayerRow = ({ index, name, accent, sizing, isLast }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      height: sizing.rowH,
      padding: '0 20px',
      background: index % 2 === 1 ? 'rgba(255,255,255,0.04)' : 'transparent',
      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.07)',
    }}
  >
    <span
      style={{
        flex: '0 0 auto',
        width: sizing.num + 16,
        height: sizing.num + 16,
        borderRadius: 12,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: accent.chip,
        border: `1px solid ${accent.stroke}`,
        color: '#ffffff',
        fontFamily: headFont,
        fontSize: sizing.num,
        lineHeight: 1,
      }}
    >
      {index + 1}
    </span>
    <span
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        color: '#f4f6ff',
        fontFamily: bodyFont,
        fontWeight: 500,
        fontSize: sizing.name,
        lineHeight: 1.1,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {name}
    </span>
  </div>
);

const TeamBlock = ({ side, team, sizing }) => {
  const accent = TEAM_ACCENTS[side];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 28,
        overflow: 'hidden',
        background: 'linear-gradient(168deg, rgba(40,31,84,0.62) 0%, rgba(16,12,33,0.82) 100%)',
        border: `1.5px solid ${accent.stroke}`,
        boxShadow: `0 0 38px ${accent.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Team header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: `${sizing.pad}px ${sizing.pad + 8}px`,
          borderBottom: `1px solid ${accent.stroke}`,
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 46,
            borderRadius: 999,
            background: accent.bar,
            boxShadow: `0 0 14px ${accent.glow}`,
          }}
        />
        <span
          style={{
            color: '#ffffff',
            fontFamily: headFont,
            fontSize: 52,
            lineHeight: 1,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {team.name}
        </span>
      </div>
      {/* Player rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {team.players.map((name, index) => (
          <PlayerRow
            key={`${side}-${index}-${name}`}
            index={index}
            name={name}
            accent={accent}
            sizing={sizing}
            isLast={index === team.players.length - 1}
          />
        ))}
      </div>
    </div>
  );
};

// Challenge-card VS: italic glowing wordmark over the same diagonal accent line.
const VersusSeparator = () => (
  <div
    style={{
      position: 'relative',
      height: 132,
      margin: '-18px 0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <span
      aria-hidden
      style={{
        position: 'absolute',
        width: 4,
        height: 150,
        transform: 'rotate(16deg)',
        borderRadius: 999,
        background: 'linear-gradient(180deg, transparent, rgba(236,0,125,0.55) 38%, rgba(139,92,255,0.6) 62%, transparent)',
      }}
    />
    <span
      style={{
        position: 'relative',
        color: '#ffffff',
        fontFamily: headFont,
        fontStyle: 'italic',
        fontWeight: 700,
        fontSize: 82,
        letterSpacing: '0.04em',
        lineHeight: 1,
        textShadow: '0 0 18px rgba(139,92,255,0.65)',
      }}
    >
      VS
    </span>
  </div>
);

/**
 * Off-screen-friendly visual card for the "EQUIPOS ARMADOS" share image.
 * Fixed 1080px wide; height follows the content so containers hug the players.
 * Consumes the view-model from buildTeamsShareCardData().
 */
const ShareableTeamsCard = forwardRef(({ data }, ref) => {
  if (!data) return null;
  const sizing = sizingForSquad(data.maxTeamSize || 0);
  const hasMeta = Boolean(data.format || data.dateTime || data.venue);

  return (
    <div
      ref={ref}
      style={{
        width: SHARE_CARD_WIDTH,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '68px 76px 56px',
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(130% 80% at 50% 0%, #221651 0%, #160e36 48%, #0d0820 100%)',
        fontFamily: bodyFont,
      }}
    >
      {/* Ambient glows */}
      <div
        style={{
          position: 'absolute', top: -180, left: -120, width: 520, height: 520,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,255,0.28), transparent 70%)',
        }}
      />
      <div
        style={{
          position: 'absolute', bottom: -160, right: -120, width: 480, height: 480,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(236,0,125,0.18), transparent 70%)',
        }}
      />

      {/* Header — starts directly with the title */}
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 30 }}>
        <div
          style={{
            color: '#ffffff',
            fontFamily: headFont,
            fontSize: 112,
            lineHeight: 0.96,
            letterSpacing: '0.02em',
            textShadow: '0 0 36px rgba(139,92,255,0.55)',
          }}
        >
          {data.title}
        </div>
        <div
          style={{
            margin: '22px auto 0',
            width: 360,
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
            gap: 16,
            marginBottom: 36,
          }}
        >
          {data.format ? <MetaChip>{data.format}</MetaChip> : null}
          {data.dateTime ? <MetaChip>{data.dateTime}</MetaChip> : null}
          {data.venue ? <MetaChip>{data.venue}</MetaChip> : null}
        </div>
      ) : null}

      {/* Teams — containers hug their players */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TeamBlock side="a" team={data.teamA} sizing={sizing} />
        <VersusSeparator />
        <TeamBlock side="b" team={data.teamB} sizing={sizing} />
      </div>

      {/* Footer — logo (smaller, dimmed) with the website underneath */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          marginTop: 44,
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

ShareableTeamsCard.displayName = 'ShareableTeamsCard';

export default ShareableTeamsCard;
