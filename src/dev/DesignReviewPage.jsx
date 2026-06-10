import React from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Dumbbell,
  Flame,
  Goal,
  LayoutGrid,
  Loader2,
  Lock,
  Medal,
  MoreVertical,
  Plus,
  Search,
  Shield,
  Sparkles,
  Star,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import MatchCard from '../components/MatchCard';
import PlayerMiniCard from '../components/PlayerMiniCard';
import EmptyStateCard from '../components/EmptyStateCard';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  mockChallenges,
  mockMatches,
  mockNotifications,
  mockPlayers,
  mockSurveyQuestions,
  reviewBranch,
} from './designReviewMockData';

const sections = [
  ['visual-system', 'Sistema visual'],
  ['home', 'Home'],
  ['matches', 'Partidos'],
  ['create-match', 'Crear partido'],
  ['admin', 'Admin'],
  ['voting', 'Votacion'],
  ['survey', 'Encuesta'],
  ['results', 'Resultados'],
  ['profile', 'Perfil'],
  ['friends', 'Amigos'],
  ['notifications', 'Notificaciones'],
  ['challenges', 'Desafios'],
  ['modals', 'Modales'],
  ['states', 'Estados'],
];

const palette = [
  ['#0c0a1d', 'Surface 0'],
  ['#141029', 'Surface 1'],
  ['#1d1740', 'Surface 2'],
  ['#6a43ff', 'Violet'],
  ['#8b5cff', 'Violet soft'],
  ['#ec007d', 'Magenta'],
  ['#22c55e', 'Success'],
  ['#f59e0b', 'Warning'],
];

const cardClass = 'surface-card rounded-card p-4 md:p-5';
const subtleCardClass = 'rounded-card border border-[rgba(148,134,255,0.16)] bg-[linear-gradient(165deg,rgba(48,38,98,0.54),rgba(20,16,41,0.9))] p-4 shadow-elev-1';
const primaryButton = 'min-h-[42px] rounded-2xl border border-white/15 bg-cta-gradient px-4 py-2 text-sm font-semibold text-white shadow-cta transition hover:brightness-110';
const secondaryButton = 'min-h-[42px] rounded-2xl border border-[rgba(148,134,255,0.3)] bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/[0.1]';
const ghostButton = 'min-h-[42px] rounded-2xl border border-transparent px-4 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/[0.07] hover:text-white';

function DesignReviewPage() {
  return (
    <main className="min-h-[100dvh] w-screen overflow-x-hidden bg-fifa-gradient text-white">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 pb-14 pt-5 sm:px-5 lg:px-8">
        <HeroHeader />
        <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <SectionNav />
          <div className="min-w-0 space-y-6">
            <VisualSystemSection />
            <HomeSection />
            <MatchesSection />
            <CreateMatchSection />
            <AdminSection />
            <VotingSection />
            <SurveySection />
            <ResultsSection />
            <ProfileSection />
            <FriendsSection />
            <NotificationsSection />
            <ChallengesSection />
            <ModalsSection />
            <StatesSection />
          </div>
        </div>
      </div>
    </main>
  );
}

function HeroHeader() {
  return (
    <header className="surface-hero overflow-hidden rounded-[22px] p-5 md:p-7">
      <div className="relative z-[1] grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="violet">{reviewBranch.name}</Badge>
            <Badge tone="magenta">{reviewBranch.note}</Badge>
          </div>
          <p className="section-eyebrow">Arma2 internal dev route</p>
          <h1 className="m-0 text-[30px] font-black leading-tight tracking-0 text-white sm:text-[38px] lg:text-[48px]">
            Arma2 Design Review
          </h1>
          <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-white/64 md:text-base">
            {reviewBranch.subtitle}. Static mock screens for visual review only: no login, no Supabase calls, no production writes.
          </p>
        </div>
        <div className="grid min-w-[230px] grid-cols-3 gap-2">
          <Metric value="14" label="Sections" />
          <Metric value="0" label="Real data" />
          <Metric value="v3" label="Visual kit" />
        </div>
      </div>
    </header>
  );
}

function SectionNav() {
  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <nav className="surface-card rounded-card p-3" aria-label="Design review sections">
        <div className="mb-3 flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-[0.16em] text-white/48">
          <LayoutGrid size={14} />
          Review
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="whitespace-nowrap rounded-xl border border-transparent px-3 py-2 text-sm font-semibold text-white/68 transition hover:border-[rgba(148,134,255,0.28)] hover:bg-white/[0.06] hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>
    </aside>
  );
}

function VisualSystemSection() {
  return (
    <ReviewSection id="visual-system" eyebrow="Tokens" title="Sistema visual" icon={Sparkles}>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <SurfaceCard>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {palette.map(([color, label]) => (
              <div key={color} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-3 h-16 rounded-xl border border-white/10 shadow-elev-1" style={{ background: color }} />
                <div className="text-xs font-bold text-white/86">{label}</div>
                <div className="mt-1 font-mono text-[11px] text-white/45">{color}</div>
              </div>
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton}>Primario</button>
              <button type="button" className={secondaryButton}>Secundario</button>
              <button type="button" className={ghostButton}>Ghost</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="violet">Abierto</Badge>
              <Badge tone="magenta">Desafio</Badge>
              <Badge tone="green">Confirmado</Badge>
              <Badge tone="amber">Pendiente</Badge>
              <Badge>Inactivo</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldPreview label="Sede" value="Complejo Costa Salguero" icon={Goal} />
              <FieldPreview label="Fecha" value="Jue 11 jun - 21:00" icon={CalendarDays} />
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <LoadingSpinner size="sm" />
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-[linear-gradient(90deg,#6a43ff,#ec007d)]" />
              </div>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function HomeSection() {
  const shortcuts = [
    [Plus, 'Crear partido', 'Nuevo F5 / F7'],
    [Users, 'Quiero jugar', 'Cupos cerca'],
    [Shield, 'Desafios', 'Equipos activos'],
    [Bell, 'Alertas', '4 sin leer'],
  ];

  return (
    <ReviewSection id="home" eyebrow="Dashboard" title="Home mock" icon={Zap}>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <SurfaceCard className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="m-0 text-sm font-semibold text-white/54">Hola, Nico</p>
              <h3 className="m-0 mt-1 text-2xl font-black text-white">Tu semana de futbol</h3>
            </div>
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-[#8b5cff]/35 bg-[#1d1740] text-sm font-black shadow-elev-1">
              NA
              <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-[#1d1740] bg-[#ec007d]" />
            </div>
          </div>
          <div className="surface-hero rounded-card p-4">
            <Badge tone="magenta">Partido recomendado</Badge>
            <h4 className="mb-2 mt-4 text-xl font-black">F5 nocturno Palermo</h4>
            <p className="m-0 text-sm leading-6 text-white/60">3 cupos libres, nivel parejo y cancha confirmada.</p>
            <button type="button" className={`${primaryButton} mt-4 w-full`}>Sumarme</button>
          </div>
        </SurfaceCard>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {shortcuts.map(([Icon, title, description]) => (
              <div key={title} className={subtleCardClass}>
                <span className="icon-tile mb-4"><Icon size={19} /></span>
                <h4 className="m-0 text-sm font-bold text-white">{title}</h4>
                <p className="m-0 mt-1 text-xs text-white/52">{description}</p>
              </div>
            ))}
          </div>
          <SurfaceCard>
            <div className="mb-4 flex items-center justify-between">
              <SectionMiniTitle title="Actividad reciente" />
              <Badge>Live</Badge>
            </div>
            <Timeline items={['Mora se sumo a tu partido', 'Equipo confirmado para el desafio', 'Resultados listos para F7 competitivo']} />
          </SurfaceCard>
        </div>
      </div>
    </ReviewSection>
  );
}

function MatchesSection() {
  return (
    <ReviewSection id="matches" eyebrow="Cards" title="Partidos / MatchCard" icon={CalendarDays}>
      <div className="grid gap-4 xl:grid-cols-2">
        {mockMatches.map((partido, index) => (
          <MatchCard
            key={partido.id}
            partido={partido}
            isFinished={partido.id === 'match-finished'}
            userRole={index === 1 ? 'admin' : 'player'}
            userJoined={index === 0}
            primaryAction={{
              label: partido.id === 'match-finished' ? 'Ver resultados' : index === 1 ? 'Administrar' : 'Ver detalle',
              onClick: () => {},
              disabled: false,
            }}
          />
        ))}
      </div>
    </ReviewSection>
  );
}

function CreateMatchSection() {
  return (
    <ReviewSection id="create-match" eyebrow="Flow" title="Crear partido" icon={Plus}>
      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <SurfaceCard>
          <Stepper active={2} labels={['Tipo', 'Cancha', 'Jugadores', 'Confirmar']} />
          <div className="mt-5 grid gap-3">
            <SelectableRow selected title="F5 rapido" description="10 jugadores, intensidad alta" />
            <SelectableRow title="F7 balanceado" description="14 jugadores, cancha grande" />
            <SelectableRow title="F11 competitivo" description="22 jugadores, formato completo" />
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldPreview label="Nombre" value="F5 jueves Palermo" icon={Goal} />
            <FieldPreview label="Modalidad" value="F5 mixto" icon={Users} />
            <FieldPreview label="Cancha" value="Il Capitano" icon={Shield} />
            <FieldPreview label="Precio por persona" value="$5.200" icon={Sparkles} />
          </div>
          <div className="mt-4 rounded-2xl border border-[#22c55e]/30 bg-[#22c55e]/10 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#86efac]">
              <CircleCheck size={17} />
              Confirmacion visual
            </div>
            <p className="m-0 mt-2 text-sm leading-6 text-white/58">Preview del resumen antes de crear. No ejecuta alta ni llama servicios.</p>
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function AdminSection() {
  return (
    <ReviewSection id="admin" eyebrow="Organizer" title="Admin del partido" icon={Shield}>
      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <SurfaceCard>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge tone="violet">Admin</Badge>
              <h3 className="mb-1 mt-3 text-2xl font-black">F5 nocturno Palermo</h3>
              <p className="m-0 text-sm text-white/58">Jueves 21:00 - Il Capitano</p>
            </div>
            <button type="button" className={primaryButton}>Armar equipos</button>
          </div>
          <SegmentedTabs tabs={['Jugadores', 'Solicitudes', 'Equipos']} activeIndex={0} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {mockPlayers.slice(0, 6).map((player) => (
              <PlayerMiniCard key={player.id} profile={player} showMenuPlaceholder />
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <SectionMiniTitle title="Solicitudes pendientes" />
          <div className="mt-4 space-y-3">
            {mockPlayers.slice(6, 9).map((player) => (
              <div key={player.id} className="flex items-center gap-3 rounded-2xl border border-[rgba(148,134,255,0.18)] bg-white/[0.04] p-3">
                <PlayerAvatar name={player.nombre} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{player.nombre}</div>
                  <div className="text-xs text-white/50">{player.posicion} - rating {player.rating}</div>
                </div>
                <button type="button" className="rounded-xl bg-[#22c55e]/15 p-2 text-[#86efac]"><Check size={17} /></button>
                <button type="button" className="rounded-xl bg-[#ef4444]/15 p-2 text-[#fca5a5]"><X size={17} /></button>
              </div>
            ))}
          </div>
          <TeamPreview />
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function VotingSection() {
  return (
    <ReviewSection id="voting" eyebrow="Teams" title="Votacion" icon={Star}>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <SurfaceCard>
          <SectionMiniTitle title="Jugadores para votar" />
          <div className="mt-4 space-y-3">
            {mockPlayers.slice(0, 5).map((player, index) => (
              <VoteCard key={player.id} player={player} selected={index === 1} voted={index < 2} />
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <div className="grid gap-3 md:grid-cols-3">
            {[6, 7, 8, 9, 10].map((score) => (
              <button
                key={score}
                type="button"
                className={`min-h-[58px] rounded-2xl border text-xl font-black transition ${score === 9 ? 'border-[#ec007d] bg-[#ec007d]/18 text-white shadow-glow-accent' : 'border-white/12 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]'}`}
              >
                {score}
              </button>
            ))}
          </div>
          <button type="button" className={`${primaryButton} mt-4 w-full`}>Enviar votos</button>
          <EmptyStateCard
            className="mx-auto mb-0 mt-4"
            title="Sin jugadores pendientes"
            description="Estado vacio para cuando todos los jugadores ya fueron votados."
          />
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function SurveySection() {
  return (
    <ReviewSection id="survey" eyebrow="Post match" title="Encuesta post partido" icon={Medal}>
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <SurfaceCard>
          <Stepper active={3} labels={mockSurveyQuestions} />
        </SurfaceCard>
        <SurfaceCard>
          <Badge tone="magenta">Paso 3 de 5</Badge>
          <h3 className="mb-2 mt-4 text-2xl font-black">Elegir MVP y arquero</h3>
          <p className="m-0 text-sm leading-6 text-white/58">Mock del flujo final: ausentes, MVP, mejor arquero, roja y confirmacion.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {mockPlayers.slice(0, 4).map((player, index) => (
              <SelectablePlayer key={player.id} player={player} selected={index === 0} />
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" className={`${secondaryButton} flex-1`}>Anterior</button>
            <button type="button" className={`${primaryButton} flex-1`}>Siguiente</button>
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function ResultsSection() {
  return (
    <ReviewSection id="results" eyebrow="Awards" title="Resultados" icon={Trophy}>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <SurfaceCard>
          <div className="grid gap-3 sm:grid-cols-3">
            <AwardCard title="MVP" name="Mora Valdez" icon={Trophy} tone="magenta" />
            <AwardCard title="Arquero" name="Nico Avayu" icon={Shield} tone="violet" />
            <AwardCard title="Fair play" name="Lara Silva" icon={CircleCheck} tone="green" />
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold">Resultado visual</span>
              <Badge tone="green">Cerrado</Badge>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
              <TeamPill name="Negro" score="7" />
              <span className="text-xs font-black text-white/38">VS</span>
              <TeamPill name="Violeta" score="5" />
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <SectionMiniTitle title="Story cards y porcentajes" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {['MVP 64%', 'Arquero 51%', 'Roja 0%', 'Ausencias 2'].map((item, index) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-sm font-bold text-white/84">{item}</div>
                <div className="mt-3 h-2 rounded-full bg-white/[0.07]">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#8b5cff,#ec007d)]" style={{ width: `${[64, 51, 4, 22][index]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function ProfileSection() {
  return (
    <ReviewSection id="profile" eyebrow="Account" title="Perfil" icon={Users}>
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <SurfaceCard>
          <div className="flex items-center gap-4">
            <PlayerAvatar name="Nico Avayu" size="lg" />
            <div>
              <h3 className="m-0 text-2xl font-black">Nico Avayu</h3>
              <p className="m-0 mt-1 text-sm text-white/58">MED - Organizador - Palermo</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Metric value="8.4" label="Rating" />
            <Metric value="36" label="Partidos" />
            <Metric value="12" label="MVP" />
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <SectionMiniTitle title="Contexto visual de ProfileCard" />
          <p className="m-0 mt-3 text-sm leading-6 text-white/58">
            Esta review no modifica ni recompone ProfileCard. El bloque muestra el contexto visual alrededor con datos mock.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <FieldPreview label="Posicion favorita" value="Mediocampista" icon={Goal} />
            <FieldPreview label="Zona" value="CABA norte" icon={Shield} />
            <FieldPreview label="Nivel" value="Competitivo" icon={Flame} />
            <FieldPreview label="Estado" value="Disponible" icon={CircleCheck} />
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function FriendsSection() {
  return (
    <ReviewSection id="friends" eyebrow="Social" title="Amigos" icon={Users}>
      <SurfaceCard>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SegmentedTabs tabs={['Amigos', 'Grupos', 'Comunidad']} activeIndex={0} />
          <div className="flex min-h-[42px] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white/48 md:w-[280px]">
            <Search size={16} />
            Buscar jugadores
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {mockPlayers.slice(0, 6).map((player, index) => (
            <div key={player.id} className={subtleCardClass}>
              <PlayerMiniCard
                profile={player}
                showMenuPlaceholder={index % 2 === 0}
                metaBadge={index === 0 ? <Badge tone="green">Online</Badge> : null}
              />
            </div>
          ))}
        </div>
      </SurfaceCard>
    </ReviewSection>
  );
}

function NotificationsSection() {
  return (
    <ReviewSection id="notifications" eyebrow="Inbox" title="Notificaciones" icon={Bell}>
      <div className="grid gap-4 xl:grid-cols-[1fr_0.75fr]">
        <SurfaceCard>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SegmentedTabs tabs={['Todas', 'Partidos', 'Desafios']} activeIndex={0} />
            <button type="button" className={secondaryButton}>Marcar leidas</button>
          </div>
          <div className="space-y-3">
            {mockNotifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <SectionMiniTitle title="Modal campanita" />
          <div className="mt-4 rounded-2xl border border-[rgba(148,134,255,0.24)] bg-[#141029]/95 p-3 shadow-elev-3">
            {mockNotifications.slice(0, 3).map((notification) => (
              <NotificationRow key={notification.id} notification={notification} compact />
            ))}
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function ChallengesSection() {
  return (
    <ReviewSection id="challenges" eyebrow="Teams" title="Desafios" icon={Dumbbell}>
      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <SurfaceCard>
          <SegmentedTabs tabs={['Hub', 'Mis equipos', 'Rivales']} activeIndex={0} />
          <div className="mt-4 space-y-3">
            {mockChallenges.map((challenge) => (
              <ChallengeCard key={challenge.id} challenge={challenge} />
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <div className="surface-hero rounded-card p-4">
            <Badge tone="magenta">Detalle equipo</Badge>
            <h3 className="mb-1 mt-4 text-2xl font-black">Tigres Norte</h3>
            <p className="m-0 text-sm text-white/58">8 victorias - 2 empates - 1 derrota</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Metric value="91" label="Quimica" />
              <Metric value="74" label="Ataque" />
              <Metric value="82" label="Defensa" />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={primaryButton}>Publicar desafio</button>
              <button type="button" className={secondaryButton}>Aceptar rival</button>
              <button type="button" className={ghostButton}>Crear equipo</button>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function ModalsSection() {
  return (
    <ReviewSection id="modals" eyebrow="Overlays" title="Modales / Dropdowns" icon={MoreVertical}>
      <div className="grid gap-4 xl:grid-cols-3">
        <ModalPreview />
        <ConfirmPreview />
        <DropdownPreview />
      </div>
    </ReviewSection>
  );
}

function StatesSection() {
  return (
    <ReviewSection id="states" eyebrow="Feedback" title="Estados" icon={CircleAlert}>
      <div className="grid gap-4 xl:grid-cols-3">
        <EmptyStateCard
          className="m-0 max-w-none"
          title="No hay partidos abiertos"
          description="Estado vacio con CTA visual para crear o buscar un nuevo partido."
          actionLabel="Buscar partidos"
          onAction={() => {}}
        />
        <SurfaceCard>
          <SectionMiniTitle title="Loading / skeleton" />
          <div className="mt-5 flex items-center gap-4">
            <LoadingSpinner size="md" />
            <Loader2 className="animate-spin text-[#cfc4ff]" />
          </div>
          <div className="mt-5 space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-2xl bg-white/[0.06]" />
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard>
          <SectionMiniTitle title="Error / success" />
          <StateBanner tone="error" title="No se pudo cargar" description="Mock de error sin request real." />
          <StateBanner tone="success" title="Cambios guardados" description="Mock de confirmacion visual." />
        </SurfaceCard>
      </div>
    </ReviewSection>
  );
}

function ReviewSection({ id, eyebrow, title, icon: Icon, children }) {
  return (
    <section id={id} className="scroll-mt-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="icon-tile h-10 w-10 rounded-[14px]"><Icon size={18} /></span>
        <div>
          <span className="section-eyebrow">{eyebrow}</span>
          <h2 className="section-title">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function SurfaceCard({ children, className = '' }) {
  return <div className={`${cardClass} ${className}`}>{children}</div>;
}

function Badge({ children, tone = 'slate' }) {
  const classes = {
    violet: 'border-[#8b5cff]/45 bg-[#8b5cff]/14 text-[#d8d0ff]',
    magenta: 'border-[#ec007d]/45 bg-[#ec007d]/14 text-[#ffb1d8]',
    green: 'border-[#22c55e]/45 bg-[#22c55e]/12 text-[#86efac]',
    amber: 'border-[#f59e0b]/45 bg-[#f59e0b]/12 text-[#fde68a]',
    slate: 'border-white/12 bg-white/[0.06] text-white/64',
  };
  return (
    <span className={`inline-flex min-h-[24px] items-center rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none ${classes[tone] || classes.slate}`}>
      {children}
    </span>
  );
}

function Metric({ value, label }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0a1d]/55 p-3 text-center">
      <div className="text-xl font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white/42">{label}</div>
    </div>
  );
}

function SectionMiniTitle({ title }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-[linear-gradient(180deg,#ec007d,#8b5cff)]" />
      <h3 className="m-0 text-base font-black text-white">{title}</h3>
    </div>
  );
}

function FieldPreview({ label, value, icon: Icon }) {
  return (
    <label className="block rounded-2xl border border-white/10 bg-[#0c0a1d]/44 p-3">
      <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/42">
        <Icon size={13} />
        {label}
      </span>
      <span className="block min-h-[42px] rounded-xl border border-[rgba(148,134,255,0.16)] bg-white/[0.04] px-3 py-3 text-sm font-semibold text-white/86">
        {value}
      </span>
    </label>
  );
}

function Timeline({ items }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item} className="grid grid-cols-[32px_1fr] gap-3">
          <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-[#8b5cff]/35 bg-[#8b5cff]/12 text-xs font-black">
            {index + 1}
          </span>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-sm font-bold text-white/84">{item}</div>
            <div className="mt-1 flex items-center gap-1 text-xs text-white/42"><Clock3 size={12} /> Mock timeline</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stepper({ active, labels }) {
  return (
    <div className="space-y-3">
      {labels.map((label, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <div key={label} className="flex items-center gap-3">
            <span className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-black ${done ? 'border-[#22c55e]/45 bg-[#22c55e]/14 text-[#86efac]' : current ? 'border-[#ec007d]/55 bg-[#ec007d]/16 text-white' : 'border-white/12 bg-white/[0.04] text-white/42'}`}>
              {done ? <Check size={15} /> : index + 1}
            </span>
            <span className={`text-sm font-bold ${current ? 'text-white' : 'text-white/58'}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SelectableRow({ selected = false, title, description }) {
  return (
    <button
      type="button"
      className={`w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-[#ec007d]/55 bg-[#ec007d]/12 shadow-glow-accent' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold text-white">{title}</span>
        {selected ? <Check size={17} className="text-[#ffb1d8]" /> : null}
      </div>
      <p className="m-0 mt-1 text-sm text-white/52">{description}</p>
    </button>
  );
}

function SelectablePlayer({ player, selected }) {
  return (
    <div className={`rounded-2xl border p-3 ${selected ? 'border-[#ec007d]/50 bg-[#ec007d]/12' : 'border-white/10 bg-white/[0.04]'}`}>
      <PlayerMiniCard profile={player} rightSlot={selected ? <Check size={18} className="text-[#ffb1d8]" /> : null} />
    </div>
  );
}

function PlayerAvatar({ name, size = 'md' }) {
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const sizeClass = size === 'lg' ? 'h-16 w-16 text-lg' : 'h-11 w-11 text-sm';
  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full border border-[#8b5cff]/45 bg-[linear-gradient(140deg,#6a43ff,#ec007d)] font-black text-white shadow-elev-1`}>
      {initials}
    </div>
  );
}

function TeamPreview() {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {['Equipo Negro', 'Equipo Violeta'].map((team, teamIndex) => (
        <div key={team} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-black">{team}</span>
            <Badge tone={teamIndex === 0 ? 'violet' : 'magenta'}>{teamIndex === 0 ? '82 avg' : '81 avg'}</Badge>
          </div>
          {mockPlayers.slice(teamIndex * 3, teamIndex * 3 + 3).map((player) => (
            <div key={player.id} className="mb-2 flex items-center justify-between rounded-xl bg-[#0c0a1d]/50 px-3 py-2 text-xs">
              <span>{player.nombre}</span>
              <span className="text-white/42">{player.posicion}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function VoteCard({ player, selected, voted }) {
  return (
    <div className={`rounded-2xl border p-3 ${selected ? 'border-[#ec007d]/55 bg-[#ec007d]/12' : 'border-white/10 bg-white/[0.04]'}`}>
      <div className="flex items-center gap-3">
        <PlayerAvatar name={player.nombre} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{player.nombre}</div>
          <div className="text-xs text-white/48">{player.posicion} - {voted ? 'Votado' : 'Pendiente'}</div>
        </div>
        <Badge tone={voted ? 'green' : 'amber'}>{voted ? 'OK' : 'Nuevo'}</Badge>
      </div>
    </div>
  );
}

function AwardCard({ title, name, icon: Icon, tone }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
      <span className="icon-tile mx-auto mb-3"><Icon size={19} /></span>
      <Badge tone={tone}>{title}</Badge>
      <div className="mt-3 text-sm font-black text-white">{name}</div>
    </div>
  );
}

function TeamPill({ name, score }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0a1d]/50 p-4">
      <div className="text-3xl font-black">{score}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-white/48">{name}</div>
    </div>
  );
}

function SegmentedTabs({ tabs, activeIndex }) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-[#0c0a1d]/52 p-1">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          type="button"
          className={`min-h-[34px] whitespace-nowrap rounded-xl px-3 text-xs font-bold transition ${index === activeIndex ? 'bg-cta-gradient text-white shadow-cta' : 'text-white/54 hover:bg-white/[0.06] hover:text-white'}`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function NotificationRow({ notification, compact = false }) {
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-3 ${notification.unread ? 'border-[#ec007d]/28 bg-[#ec007d]/10' : 'border-white/10 bg-white/[0.04]'} ${compact ? 'mb-2' : ''}`}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#8b5cff]/30 bg-[#8b5cff]/12 text-[#cfc4ff]">
        <Bell size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white/88">{notification.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/44">
          <span>{notification.meta}</span>
          <span>{notification.type}</span>
        </div>
      </div>
      {notification.unread ? <span className="mt-2 h-2 w-2 rounded-full bg-[#ec007d]" /> : null}
    </div>
  );
}

function ChallengeCard({ challenge }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-black">{challenge.team}</h3>
          <p className="m-0 mt-1 text-xs text-white/48">{challenge.record} - {challenge.level}</p>
        </div>
        <Badge tone={challenge.status.includes('recibido') ? 'magenta' : 'violet'}>{challenge.status}</Badge>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className={`${primaryButton} flex-1`}>Ver</button>
        <button type="button" className="kebab-menu-btn h-[42px] w-[42px]" aria-label="Opciones de desafio"><MoreVertical size={17} /></button>
      </div>
    </div>
  );
}

function ModalPreview() {
  return (
    <SurfaceCard>
      <SectionMiniTitle title="Modal normal" />
      <div className="mt-4 rounded-[20px] border border-[rgba(148,134,255,0.3)] bg-[#141029]/95 p-4 shadow-elev-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="m-0 text-lg font-black">Invitar jugador</h3>
            <p className="m-0 mt-2 text-sm leading-6 text-white/58">Overlay visual con acciones primarias y secundarias.</p>
          </div>
          <button type="button" className="kebab-menu-btn" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <button type="button" className={`${primaryButton} mt-4 w-full`}>Enviar invitacion</button>
      </div>
    </SurfaceCard>
  );
}

function ConfirmPreview() {
  return (
    <SurfaceCard>
      <SectionMiniTitle title="Confirm modal" />
      <div className="mt-4 rounded-[20px] border border-[#ef4444]/30 bg-[#451a1a]/30 p-4">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#ef4444]/35 bg-[#ef4444]/14 text-[#fca5a5]">
          <CircleAlert size={21} />
        </div>
        <h3 className="m-0 text-lg font-black">Cancelar partido</h3>
        <p className="m-0 mt-2 text-sm leading-6 text-white/58">Preview destructivo sin ejecutar ninguna accion real.</p>
        <div className="mt-4 flex gap-3">
          <button type="button" className={`${secondaryButton} flex-1`}>Volver</button>
          <button type="button" className="min-h-[42px] flex-1 rounded-2xl border border-[#ef4444]/35 bg-[#ef4444]/18 px-4 py-2 text-sm font-semibold text-[#fecaca]">Cancelar</button>
        </div>
      </div>
    </SurfaceCard>
  );
}

function DropdownPreview() {
  return (
    <SurfaceCard>
      <SectionMiniTitle title="Dropdown / filtros" />
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <button type="button" className="flex min-h-[42px] w-full items-center justify-between rounded-xl border border-[rgba(148,134,255,0.22)] bg-[#0c0a1d]/60 px-3 text-sm font-bold text-white/86">
          Ordenar por fecha
          <ChevronDown size={16} />
        </button>
        <div className="admin-action-menu mt-2">
          <button type="button" className="admin-action-menu-item">Proximos primero</button>
          <button type="button" className="admin-action-menu-item">Con cupos libres</button>
          <button type="button" className="admin-action-menu-item admin-action-menu-item--danger">Limpiar filtros</button>
        </div>
      </div>
    </SurfaceCard>
  );
}

function StateBanner({ tone, title, description }) {
  const isError = tone === 'error';
  return (
    <div className={`mt-4 rounded-2xl border p-4 ${isError ? 'border-[#ef4444]/30 bg-[#ef4444]/10' : 'border-[#22c55e]/30 bg-[#22c55e]/10'}`}>
      <div className={`flex items-center gap-2 text-sm font-bold ${isError ? 'text-[#fca5a5]' : 'text-[#86efac]'}`}>
        {isError ? <CircleAlert size={17} /> : <CircleCheck size={17} />}
        {title}
      </div>
      <p className="m-0 mt-2 text-sm text-white/54">{description}</p>
    </div>
  );
}

export default DesignReviewPage;

