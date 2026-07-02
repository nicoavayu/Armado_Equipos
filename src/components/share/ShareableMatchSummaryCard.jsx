import React, { forwardRef } from 'react';
import logo from '../../Logo.png';

// Shareable "RESUMEN DEL PARTIDO" image card. Same visual language and fixed
// 1080px width as ShareableTeamsCard (vertical-friendly for WhatsApp/stories,
// height hugs the content). Consumes the view-model from
// buildMatchSummaryShareCardData(); sections without data are simply omitted.
export const SUMMARY_CARD_WIDTH = 1080;

const VIOLET = '#8b5cff';
const BLUE = '#4ea8ff';
const PINK = '#ec007d';
const GOLD = '#f5c451';

const TEAM_ACCENTS = {
  a: { stroke: 'rgba(139,92,255,0.55)', glow: 'rgba(139,92,255,0.30)', bar: VIOLET, chip: 'rgba(139,92,255,0.18)' },
  b: { stroke: 'rgba(78,168,255,0.55)', glow: 'rgba(78,168,255,0.28)', bar: BLUE, chip: 'rgba(78,168,255,0.16)' },
};

const headFont = "'Bebas Neue', 'Oswald', sans-serif";
const bodyFont = "'Oswald', 'Inter', sans-serif";

// Side-by-side columns get roughly half the width of the teams card, so the
// type scale is tighter but follows the same "shrink as squads grow" idea.
const sizingForSquad = (maxTeamSize) => {
  if (maxTeamSize <= 5) return { name: 30, num: 24, rowH: 58, pad: 16, header: 36 };
  if (maxTeamSize <= 7) return { name: 27, num: 22, rowH: 52, pad: 14, header: 34 };
  if (maxTeamSize <= 9) return { name: 24, num: 20, rowH: 46, pad: 12, header: 31 };
  return { name: 21, num: 18, rowH: 40, pad: 11, header: 28 };
};

const MetaChip = ({ children }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '9px 20px',
      borderRadius: 999,
      border: '1.5px solid rgba(148,134,255,0.32)',
      background: 'rgba(20,16,41,0.6)',
      color: 'rgba(242,246,255,0.92)',
      fontFamily: bodyFont,
      fontWeight: 600,
      fontSize: 27,
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

const TeamColumn = ({ side, team, sizing, isWinner }) => {
  const accent = TEAM_ACCENTS[side];
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 22,
        overflow: 'hidden',
        background: 'linear-gradient(168deg, rgba(40,31,84,0.62) 0%, rgba(16,12,33,0.82) 100%)',
        border: `1.5px solid ${isWinner ? 'rgba(245,196,81,0.65)' : accent.stroke}`,
        boxShadow: isWinner
          ? `0 0 34px rgba(245,196,81,0.22), 0 0 24px ${accent.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`
          : `0 0 28px ${accent.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: `${sizing.pad}px ${sizing.pad + 6}px`,
          borderBottom: `1px solid ${accent.stroke}`,
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              width: 6,
              height: 32,
              borderRadius: 999,
              background: accent.bar,
              boxShadow: `0 0 12px ${accent.glow}`,
              flex: '0 0 auto',
            }}
          />
          <span
            style={{
              color: '#ffffff',
              fontFamily: headFont,
              fontSize: sizing.header,
              lineHeight: 1,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {team.name}
          </span>
        </span>
        {isWinner ? (
          <span
            style={{
              flex: '0 0 auto',
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid rgba(245,196,81,0.55)',
              background: 'rgba(245,196,81,0.14)',
              color: GOLD,
              fontFamily: bodyFont,
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >
            GANADOR
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {team.players.map((name, index) => (
          <div
            key={`${side}-${index}-${name}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              height: sizing.rowH,
              padding: '0 14px',
              background: index % 2 === 1 ? 'rgba(255,255,255,0.04)' : 'transparent',
              borderBottom: index === team.players.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span
              style={{
                flex: '0 0 auto',
                width: sizing.num + 12,
                height: sizing.num + 12,
                borderRadius: 9,
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
        ))}
      </div>
    </div>
  );
};

const AwardRow = ({ award }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      padding: '16px 22px',
      borderRadius: 18,
      border: '1px solid rgba(255,255,255,0.10)',
      background: 'rgba(255,255,255,0.045)',
    }}
  >
    <img
      src={award.icon}
      alt={award.label}
      width={52}
      height={52}
      draggable={false}
      style={{ filter: `drop-shadow(0 0 14px ${award.color})`, flex: '0 0 auto' }}
    />
    <span
      style={{
        flex: '0 0 auto',
        color: 'rgba(244,246,255,0.6)',
        fontFamily: headFont,
        fontSize: 32,
        lineHeight: 1,
        letterSpacing: '0.06em',
        whiteSpace: 'nowrap',
      }}
    >
      {award.label}
    </span>
    <span
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        textAlign: 'right',
        color: '#ffffff',
        fontFamily: bodyFont,
        fontWeight: 600,
        fontSize: 32,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {award.playerName}
    </span>
  </div>
);

const ShareableMatchSummaryCard = forwardRef(({ data }, ref) => {
  if (!data) return null;
  const sizing = sizingForSquad(data.maxTeamSize || 0);
  const hasMeta = Boolean(data.format || data.dateTime || data.venue);
  const winnerSide = data.result?.outcome === 'winner'
    ? (data.result.winnerTeam === 'A' ? 'a' : 'b')
    : null;

  return (
    <div
      ref={ref}
      style={{
        width: SUMMARY_CARD_WIDTH,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '64px 72px 52px',
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

      {/* Header */}
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 26 }}>
        <div
          style={{
            color: '#ffffff',
            fontFamily: headFont,
            fontSize: 92,
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
              marginTop: 16,
              color: '#cfc4ff',
              fontFamily: bodyFont,
              fontWeight: 700,
              fontSize: 40,
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
            margin: '20px auto 0',
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
            gap: 14,
            marginBottom: 34,
          }}
        >
          {data.format ? <MetaChip>{data.format}</MetaChip> : null}
          {data.dateTime ? <MetaChip>{data.dateTime}</MetaChip> : null}
          {data.venue ? <MetaChip>{data.venue}</MetaChip> : null}
        </div>
      ) : null}

      {/* Result — only when a real winner/draw exists */}
      {data.result ? (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            padding: '30px 24px',
            marginBottom: 34,
            borderRadius: 24,
            border: `1.5px solid ${data.result.outcome === 'winner' ? 'rgba(245,196,81,0.45)' : 'rgba(148,134,255,0.32)'}`,
            background: data.result.outcome === 'winner'
              ? 'radial-gradient(420px 160px at 50% -40%, rgba(245,196,81,0.16), transparent 70%), linear-gradient(168deg, rgba(40,31,84,0.62), rgba(16,12,33,0.85))'
              : 'linear-gradient(168deg, rgba(40,31,84,0.62), rgba(16,12,33,0.85))',
          }}
        >
          <span
            style={{
              color: 'rgba(244,246,255,0.55)',
              fontFamily: bodyFont,
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '0.28em',
            }}
          >
            RESULTADO
          </span>
          <span
            style={{
              color: data.result.outcome === 'winner' ? GOLD : '#ffffff',
              fontFamily: headFont,
              fontSize: 74,
              lineHeight: 1,
              letterSpacing: '0.03em',
              textShadow: data.result.outcome === 'winner'
                ? '0 0 26px rgba(245,196,81,0.45)'
                : '0 0 22px rgba(139,92,255,0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            {data.result.label}
          </span>
          {data.result.scoreline ? (
            <span
              style={{
                padding: '8px 22px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.16)',
                background: 'rgba(12,10,29,0.7)',
                color: '#ffffff',
                fontFamily: headFont,
                fontSize: 44,
                lineHeight: 1,
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
              }}
            >
              {data.result.scoreline}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Teams — side by side, winner highlighted */}
      {data.teams ? (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            gap: 22,
            alignItems: 'flex-start',
            marginBottom: 34,
          }}
        >
          <TeamColumn side="a" team={data.teams.teamA} sizing={sizing} isWinner={winnerSide === 'a'} />
          <TeamColumn side="b" team={data.teams.teamB} sizing={sizing} isWinner={winnerSide === 'b'} />
        </div>
      ) : null}

      {/* Awards — only real awards, no empty container */}
      {data.awards && data.awards.length > 0 ? (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <span
            style={{
              textAlign: 'center',
              color: 'rgba(244,246,255,0.55)',
              fontFamily: bodyFont,
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '0.28em',
              marginBottom: 2,
            }}
          >
            PREMIOS
          </span>
          {data.awards.map((award) => (
            <AwardRow key={award.kind} award={award} />
          ))}
        </div>
      ) : null}

      {/* Footer */}
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

ShareableMatchSummaryCard.displayName = 'ShareableMatchSummaryCard';

export default ShareableMatchSummaryCard;
