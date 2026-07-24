import React from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Gavel,
  MapPin,
  Megaphone,
  Plus,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import styles from './TorneosShell.module.css';

const metrics = [
  { label: 'Partidos hoy', value: '06', note: '2 por confirmar', icon: CalendarClock },
  { label: 'Equipos activos', value: '16', note: '1 pendiente', icon: Users },
  { label: 'Próxima fecha', value: 'F. 08', note: 'Dom 12 sep', icon: Trophy },
  { label: 'Sanciones', value: '03', note: 'requieren revisión', icon: Gavel },
];

const quickActions = [
  { label: 'Cargar resultado', icon: CheckCircle2 },
  { label: 'Programar partido', icon: Clock3 },
  { label: 'Publicar aviso', icon: Megaphone },
  { label: 'Agregar equipo', icon: Plus },
];

const matches = [
  { time: '18:30', home: 'Barrio Norte', away: 'Los Pibes FC', court: 'Cancha 1', state: 'Programado' },
  { time: '20:00', home: 'El Rejunte', away: 'La 12 Devoto', court: 'Cancha 2', state: 'Pendiente' },
  { time: '21:30', home: 'Malvinas', away: 'Defensores', court: 'Cancha 1', state: 'Programado' },
];

export default function TorneosDashboard() {
  const { activeWorkspace, selectedSeason, selectedTournament } = useTorneosWorkspace();

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Panel operativo · Preview</span>
          <h1>Todo listo para la <em>fecha 08.</em></h1>
          <p>
            {activeWorkspace?.name} · {selectedSeason?.name} · {selectedTournament?.name}
          </p>
        </div>
        <div className={styles.heroStatus}>
          <span className={styles.statusPulse} aria-hidden="true" />
          <div>
            <small>Estado de la jornada</small>
            <strong>4 de 6 partidos programados</strong>
          </div>
        </div>
      </section>

      <section className={styles.metricsGrid} aria-label="Resumen del torneo">
        {metrics.map(({ label, value, note, icon: Icon }) => (
          <article className={styles.metricCard} key={label}>
            <div className={styles.metricIcon}><Icon size={19} /></div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className={styles.dashboardGrid}>
        <div className={styles.primaryColumn}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.eyebrow}>Domingo 12 de septiembre</span>
                <h2>Próximos partidos</h2>
              </div>
              <button type="button" className={styles.textButton} disabled>
                Ver fecha <ArrowUpRight size={16} />
              </button>
            </div>

            <div className={styles.matchList}>
              {matches.map((match) => (
                <div className={styles.matchRow} key={`${match.time}-${match.home}`}>
                  <time>{match.time}</time>
                  <div className={styles.teams}>
                    <strong>{match.home}</strong>
                    <span>vs</span>
                    <strong>{match.away}</strong>
                  </div>
                  <span className={styles.court}>
                    <MapPin size={14} /> {match.court}
                  </span>
                  <span className={match.state === 'Pendiente' ? styles.pendingChip : styles.statusChip}>
                    {match.state}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.eyebrow}>Accesos directos</span>
                <h2>Resolver en pocos toques</h2>
              </div>
            </div>
            <div className={styles.quickActions}>
              {quickActions.map(({ label, icon: Icon }) => (
                <button type="button" key={label} disabled>
                  <Icon size={19} />
                  <span>{label}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          </article>
        </div>

        <aside className={styles.secondaryColumn}>
          <article className={`${styles.panel} ${styles.alertPanel}`}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.eyebrow}>Atención</span>
                <h2>Alertas operativas</h2>
              </div>
              <span className={styles.alertCount}>3</span>
            </div>
            <div className={styles.alertList}>
              <div>
                <CircleAlert size={18} />
                <span><strong>2 resultados</strong> esperan confirmación</span>
              </div>
              <div>
                <ShieldCheck size={18} />
                <span><strong>1 plantel</strong> requiere revisión</span>
              </div>
              <div>
                <Gavel size={18} />
                <span><strong>3 sanciones</strong> sugeridas por tarjetas</span>
              </div>
            </div>
          </article>

          <article className={`${styles.panel} ${styles.messagePanel}`}>
            <Megaphone size={22} />
            <span className={styles.eyebrow}>Comunicado reciente</span>
            <h2>Horarios confirmados para la próxima fecha</h2>
            <p>Publicado hoy a las 10:42 · Visible para 16 equipos</p>
          </article>
        </aside>
      </section>
    </div>
  );
}
