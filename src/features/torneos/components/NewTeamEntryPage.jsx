import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  Loader2,
  Search,
  ShieldPlus,
  UserRound,
} from 'lucide-react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { getTeamRegistrationAvailability } from '../domain/competitionLifecycle';
import styles from './TeamRegistration.module.css';

export default function NewTeamEntryPage() {
  const { organization } = useOutletContext();
  const { activeTournament } = useTorneosCompetition();
  const { service } = useTorneosWorkspace();
  const navigate = useNavigate();
  const keyRef = useRef(service.createIdempotencyKey());
  const [mode, setMode] = useState('provisional');
  const [teamSearch, setTeamSearch] = useState('');
  const [teamResults, setTeamResults] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [form, setForm] = useState({
    categoryId: activeTournament?.categories?.[0]?.id || '',
    name: '',
    shortName: '',
    primaryColor: '#4F7CFF',
    secondaryColor: '#111827',
    managerDisplayName: '',
    managerEmail: '',
  });
  const [state, setState] = useState({ status: 'idle', error: '' });
  const [createdInvitation, setCreatedInvitation] = useState(null);
  const base = `/torneos/organizacion/${organization.id}/equipos`;

  useEffect(() => {
    if (!activeTournament?.id || mode !== 'arma2_team' || teamSearch.trim().length < 2) {
      setTeamResults([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      service.searchArma2Teams({
        organizationId: organization.id,
        tournamentId: activeTournament.id,
        query: teamSearch.trim(),
      }).then((results) => {
        if (active) setTeamResults(Array.isArray(results) ? results : []);
      }).catch(() => {
        if (active) setTeamResults([]);
      });
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeTournament?.id, mode, organization.id, service, teamSearch]);

  const update = (field) => (event) => setForm((current) => ({
    ...current,
    [field]: event.target.value,
  }));
  const submit = async (event) => {
    event.preventDefault();
    setState({ status: 'saving', error: '' });
    try {
      const result = await service.createTeamEntry({
        organizationId: organization.id,
        tournamentId: activeTournament.id,
        categoryId: form.categoryId,
        arma2TeamId: selectedTeam?.id || null,
        name: selectedTeam?.name || form.name,
        shortName: form.shortName,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        registrationSource: mode,
        managerEmail: form.managerEmail,
        managerDisplayName: form.managerDisplayName,
        idempotencyKey: keyRef.current,
      });
      const invitation = await service.inviteTeamManager({
        organizationId: organization.id,
        teamEntryId: result.entryId,
        email: form.managerEmail,
        displayName: form.managerDisplayName,
        role: 'captain',
      });
      setCreatedInvitation({
        entryId: result.entryId,
        url: `${window.location.origin}/torneos/invitacion/equipo/${invitation.token}`,
        expiresAt: invitation.expiresAt,
      });
      setState({ status: 'success', error: '' });
    } catch (error) {
      setState({ status: 'error', error: error.message });
    }
  };

  const registration = getTeamRegistrationAvailability(activeTournament);
  if (!registration.canAdd) {
    return (
      <section className={styles.emptyState}>
        <ShieldPlus size={28} />
        <h1>{registration.title}</h1>
        <p>{registration.description}</p>
        <Link to={base}>Volver a equipos</Link>
      </section>
    );
  }

  if (createdInvitation) {
    return (
      <div className={styles.formPage}>
        <header className={styles.formHeader}>
          <span className={styles.kicker}>Inscripción creada</span>
          <h1>Compartí la invitación una sola vez</h1>
          <p>
            El enlace no volverá a mostrarse. Vence el{' '}
            {new Date(createdInvitation.expiresAt).toLocaleString('es-AR')}.
          </p>
        </header>
        <section className={styles.formSection}>
          <label>
            Enlace privado del responsable
            <input
              value={createdInvitation.url}
              readOnly
              aria-label="Enlace privado del responsable"
            />
          </label>
          <div className={styles.stickyActions}>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(createdInvitation.url)}
            >
              <Copy size={17} /> Copiar enlace
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => navigate(`${base}/${createdInvitation.entryId}/inscripcion`)}
            >
              Abrir inscripción
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.formPage}>
      <Link className={styles.backLink} to={base}><ArrowLeft size={17} /> Equipos</Link>
      <header className={styles.formHeader}>
        <span className={styles.kicker}>Alta manual</span>
        <h1>Agregar equipo</h1>
        <p>{activeTournament.name} · la inscripción se guarda primero como borrador.</p>
      </header>

      <form className={styles.teamForm} onSubmit={submit}>
        <fieldset className={styles.modePicker}>
          <legend>Tipo de equipo</legend>
          <button
            type="button"
            aria-pressed={mode === 'provisional'}
            onClick={() => setMode('provisional')}
          >
            <ShieldPlus size={21} />
            <span><strong>Equipo provisional</strong><small>No necesita cuenta Arma2</small></span>
            {mode === 'provisional' && <Check size={18} />}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'arma2_team'}
            onClick={() => setMode('arma2_team')}
          >
            <Link2 size={21} />
            <span><strong>Equipo existente</strong><small>Disponible desde el buscador seguro</small></span>
          </button>
        </fieldset>

        {mode === 'arma2_team' && (
          <section className={styles.formSection}>
            <div className={styles.sectionHeading}>
              <span>00</span>
              <div><h2>Buscar equipo de Arma2</h2><p>La selección no modifica su perfil general.</p></div>
            </div>
            <label>
              Nombre del equipo
              <span className={styles.searchField}>
                <Search size={17} />
                <input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Escribí al menos 2 letras" />
              </span>
            </label>
            {teamResults.length > 0 && (
              <div className={styles.searchResults}>
                {teamResults.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => {
                      setSelectedTeam(team);
                      setForm((current) => ({
                        ...current,
                        name: team.name,
                        primaryColor: team.primaryColor || current.primaryColor,
                        secondaryColor: team.secondaryColor || current.secondaryColor,
                      }));
                      setTeamSearch(team.name);
                      setTeamResults([]);
                    }}
                  >
                    <span className={styles.avatar}>{team.name.slice(0, 2)}</span>
                    <span><strong>{team.name}</strong><small>Fútbol {team.format}</small></span>
                    {selectedTeam?.id === team.id && <Check size={18} />}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}>
            <span>01</span>
            <div><h2>Identidad competitiva</h2><p>Snapshot usado únicamente en este torneo.</p></div>
          </div>
          <label>
            Categoría
            <select value={form.categoryId} onChange={update('categoryId')} required>
              {(activeTournament.categories || []).filter((category) => category.status === 'active')
                .map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
            </select>
          </label>
          <div className={styles.twoColumns}>
            <label>
              Nombre
              <input value={form.name} onChange={update('name')} minLength="2" maxLength="100" required readOnly={mode === 'arma2_team'} />
            </label>
            <label>
              Nombre corto
              <input value={form.shortName} onChange={update('shortName')} maxLength="20" />
            </label>
          </div>
          <div className={styles.colorFields}>
            <label>Color principal<input type="color" value={form.primaryColor} onChange={update('primaryColor')} /></label>
            <label>Color secundario<input type="color" value={form.secondaryColor} onChange={update('secondaryColor')} /></label>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}>
            <span>02</span>
            <div><h2>Responsable</h2><p>El enlace se genera para QA; no se envía ningún email.</p></div>
          </div>
          <div className={styles.twoColumns}>
            <label>
              <UserRound size={16} /> Nombre
              <input value={form.managerDisplayName} onChange={update('managerDisplayName')} required />
            </label>
            <label>
              Email
              <input type="email" value={form.managerEmail} onChange={update('managerEmail')} required />
            </label>
          </div>
        </section>

        {state.error && <div className={styles.errorBanner} role="alert">{state.error}</div>}
        <div className={styles.stickyActions}>
          <Link to={base}>Cancelar</Link>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={state.status === 'saving' || (mode === 'arma2_team' && !selectedTeam)}
          >
            {state.status === 'saving' ? <Loader2 className={styles.spin} size={18} /> : <ShieldPlus size={18} />}
            Guardar inscripción
          </button>
        </div>
      </form>
    </div>
  );
}
