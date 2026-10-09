import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ProfileCard from '../ProfileCard';
import { CEREMONY_AWARDS, cardProfileAt } from '../../utils/awardsCeremony';
import './AwardScene.css';

// One award inside the awards story: presentation → winner card → trophy spins in →
// trophy flies into the card → impact and the card's own counter updates.
// Phase start times (ms); the story gives each award ~3.2 s.
const PHASE_AT = [0, 350, 900, 1650, 2100];
const LANDED = PHASE_AT.length - 1;
const FLYING = LANDED - 1;

const SCENE_BACKGROUND = {
  mvp: 'linear-gradient(135deg,#070B18 0%,#1B1030 35%,#070B18 100%)',
  best_gk: 'linear-gradient(135deg,#061019 0%,#062F3A 40%,#061019 100%)',
  red_card: 'linear-gradient(135deg,#12060B 0%,#3A0A18 42%,#12060B 100%)',
  penalty: 'linear-gradient(135deg,#0B0F16 0%,#1B2432 45%,#0B0F16 100%)',
};

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_error) {
    return false;
  }
};

// Where the trophy lands: its tile in the card's awards rail when the card already shows
// it, otherwise the rating (penalty) or the card itself.
const findImpactTarget = (cardZone, entry, icon) => {
  if (!cardZone) return null;
  if (entry.penalty) {
    return cardZone.querySelector('.rating-value') || cardZone.querySelector('.pc-card-shell');
  }
  const tile = Array.from(cardZone.querySelectorAll('.pc-awards-side-card'))
    .find((node) => node.querySelector(`img[src="${icon}"]`));
  return tile || cardZone.querySelector('.pc-card-shell') || cardZone;
};

const Confirmation = ({ entry, meta }) => {
  if (entry.penalty) {
    return (
      <div className="awd-confirm awd-confirm--negative">
        <img src={meta.icon} alt="" className="awd-confirm__icon" />
        <div className="awd-confirm__text">
          <span className="awd-confirm__value">
            {entry.penalty.from}
            <span className="awd-confirm__arrow" aria-hidden="true">→</span>
            {entry.penalty.to}
          </span>
          <span className="awd-confirm__note">Ranking por ausencia</span>
        </div>
      </div>
    );
  }
  const { counter } = entry;
  return (
    <div className={`awd-confirm ${meta.positive ? '' : 'awd-confirm--negative'}`}>
      <img src={meta.icon} alt="" className="awd-confirm__icon" />
      <div className="awd-confirm__text">
        {counter ? (
          <span className="awd-confirm__value">
            {counter.total}
            <span className="awd-confirm__unit">{meta.counterLabel(counter.total)}</span>
          </span>
        ) : null}
        <span className="awd-confirm__note">
          {counter ? <span aria-hidden="true">✓ </span> : null}
          {entry.collectionNote}
        </span>
      </div>
    </div>
  );
};

const AwardScene = ({ entry }) => {
  const meta = CEREMONY_AWARDS[entry.type];
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const [phase, setPhase] = useState(reducedMotion ? LANDED : 0);
  const [flight, setFlight] = useState(null);
  const sceneRef = useRef(null);
  const cardZoneRef = useRef(null);
  const trophyRef = useRef(null);
  const cardFitRef = useRef(null);
  const [cardScale, setCardScale] = useState(1);
  const landed = phase >= LANDED;

  // Fit the card in the height left between the title and the trophy.
  useLayoutEffect(() => {
    const fit = () => {
      const zone = cardZoneRef.current;
      const card = cardFitRef.current;
      if (!zone || !card || !card.offsetHeight) return;
      setCardScale(Math.min(1, zone.clientHeight / card.offsetHeight));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const timers = PHASE_AT.slice(1).map((at, index) => setTimeout(() => setPhase(index + 1), at));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [reducedMotion]);

  useLayoutEffect(() => {
    if (phase !== FLYING || flight) return;
    const scene = sceneRef.current?.getBoundingClientRect();
    const from = trophyRef.current?.getBoundingClientRect();
    const target = findImpactTarget(cardZoneRef.current, entry, meta.icon)?.getBoundingClientRect();
    if (!scene || !from || !target || !from.width) return;
    const toX = target.left + target.width / 2;
    const toY = target.top + target.height / 2;
    setFlight({
      dx: toX - (from.left + from.width / 2),
      dy: toY - (from.top + from.height / 2),
      impactX: toX - scene.left,
      impactY: toY - scene.top,
    });
  }, [phase, flight, entry, meta.icon]);

  const tone = meta.positive ? 'positive' : 'negative';
  const profile = cardProfileAt(entry, landed);
  const ratingOverride = entry.penalty
    ? Number(landed ? entry.penalty.to : entry.penalty.from)
    : null;

  return (
    <div
      ref={sceneRef}
      className={`awd-scene awd-scene--${tone} ${reducedMotion ? 'is-static' : ''}`}
      style={{ background: SCENE_BACKGROUND[entry.type], '--awd-accent': meta.accent, '--awd-glow': meta.glow }}
    >
      <div className="awd-glow" aria-hidden="true" />

      <div className="awd-head">
        <span className={`awd-chip awd-chip--${tone} ${entry.isMine && meta.positive ? 'awd-chip--mine' : ''}`}>{entry.chip}</span>
        <div className="awd-title font-bebas-real">{meta.title}</div>
        {entry.votesLabel ? <span className="awd-votes">{entry.votesLabel}</span> : null}
      </div>

      <div
        ref={cardZoneRef}
        className={`awd-card ${phase >= 1 ? 'is-in' : ''} ${landed && !reducedMotion ? 'is-hit' : ''}`}
      >
        <div ref={cardFitRef} className="awd-card__fit" style={cardScale < 1 ? { transform: `scale(${cardScale})` } : undefined}>
          <ProfileCard
            profile={profile}
            isVisible
            ratingOverride={ratingOverride}
            enableTilt={false}
            disableInternalMotion
            awardsLayout="space-left"
            showSideAwards
          />
        </div>
        {entry.hint ? <span className="awd-hint">{entry.hint}</span> : null}
      </div>

      <div className="awd-footer">
        {!landed ? (
          <div className={`awd-trophy ${phase >= 2 ? 'is-on' : ''} ${phase === FLYING && flight ? 'is-flying' : ''}`}
            style={flight ? { '--awd-dx': `${flight.dx}px`, '--awd-dy': `${flight.dy}px` } : undefined}
          >
            {meta.positive ? (
              <div className="awd-orbit" aria-hidden="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <span key={i} style={{ '--awd-angle': `${i * 45}deg` }} />
                ))}
              </div>
            ) : null}
            <img ref={trophyRef} src={meta.icon} alt={meta.longTitle} className="awd-trophy__img" />
          </div>
        ) : (
          <Confirmation entry={entry} meta={meta} />
        )}
      </div>

      {landed && flight && !reducedMotion ? (
        <div className="awd-impact" style={{ left: flight.impactX, top: flight.impactY }} aria-hidden="true">
          <span className="awd-impact__ring" />
          {meta.positive ? Array.from({ length: 10 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i} className="awd-impact__spark" style={{ '--awd-angle': `${i * 36}deg` }} />
          )) : null}
        </div>
      ) : null}
    </div>
  );
};

export default AwardScene;
