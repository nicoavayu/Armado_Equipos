import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Bell,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { getRoleLabel } from '../../domain/rolePresentation';
import { registrationStage } from '../../domain/connectedProduct';
import { announceTorneosProfileChanged, useTorneosProfile } from './useTorneosProfile';
import styles from './ConnectedProduct.module.css';

function RelationsSection() {
  const { service, availableOrganizations } = useTorneosWorkspace();
  const [relations, setRelations] = useState({ status: 'loading', teams: [], registrations: [] });

  useEffect(() => {
    let active = true;
    Promise.all([
      typeof service?.loadExperienceRelations === 'function'
        ? service.loadExperienceRelations().catch(() => null)
        : service?.loadMyTournaments?.({ limit: 50, offset: 0 }).catch(() => null),
      typeof service?.loadMyRegistrations === 'function'
        ? service.loadMyRegistrations({ limit: 50, offset: 0 }).catch(() => null)
        : Promise.resolve(null),
    ]).then(([teamPayload, registrationPayload]) => {
      if (!active) return;
      setRelations({
        status: 'ready',
        teams: (teamPayload?.items || []).filter((item) => item.teamEntryId),
        registrations: (registrationPayload?.items || []).filter((item) => item.status !== 'approved'),
      });
    });
    return () => { active = false; };
  }, [service]);

  const organizations = availableOrganizations || [];
  const empty = relations.status === 'ready' && !organizations.length && !relations.teams.length && !relations.registrations.length;

  return (
    <section className={styles.profileSection} aria-labelledby="profile-relations-title">
      <header>
        <h2 id="profile-relations-title"><BadgeCheck size={18} aria-hidden="true" /> Tus vínculos en Torneos</h2>
        <p>Los asigna cada organización o equipo. No se pueden cambiar desde acá.</p>
      </header>
      {relations.status === 'loading' && <p className={styles.help} role="status">Cargando vínculos…</p>}
      {empty && (
        <p className={styles.help}>
          Todavía no tenés vínculos. Aparecen cuando una organización te suma como miembro, cuando un equipo te incluye
          en su plantel aprobado o cuando pedís una inscripción.
        </p>
      )}
      <ul className={styles.relationList}>
        {organizations.map((organization) => (
          <li key={`organization:${organization.id}`}>
            <strong>{organization.name}</strong>
            <span>Organización · {getRoleLabel(organization.role, 'Miembro')}</span>
          </li>
        ))}
        {relations.teams.map((item) => (
          <li key={`team:${item.teamEntryId}:${item.categoryId}`}>
            <strong>{item.teamName}</strong>
            <span>{item.tournamentName} · {getRoleLabel(item.role, 'Participante')}</span>
          </li>
        ))}
        {relations.registrations.map((item) => (
          <li key={`registration:${item.teamEntryId}`}>
            <strong>{item.teamName}</strong>
            <span>{item.tournamentName} · Responsable · {registrationStage(item.status).label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Mi perfil de Torneos. The shared identity (email, Core name and avatar) is shown, never edited here; Torneos keeps
// its own presentation name and the notification choices its inbox can really honour. Account actions are apart.
export default function TorneosProfilePage() {
  const { service } = useTorneosWorkspace();
  const profile = useTorneosProfile();
  const [form, setForm] = useState({ displayName: '', notifyRegistrationRequests: true });
  const [save, setSave] = useState({ status: 'idle', message: '' });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (profile.status === 'ready') {
      setForm({
        displayName: profile.profile?.displayName || '',
        notifyRegistrationRequests: profile.profile?.notifyRegistrationRequests !== false,
      });
    }
  }, [profile.profile, profile.status]);

  const dirty = useMemo(() => profile.status === 'ready' && (
    (form.displayName.trim() || null) !== (profile.profile?.displayName || null)
    || form.notifyRegistrationRequests !== (profile.profile?.notifyRegistrationRequests !== false)
  ), [form, profile.profile, profile.status]);
  const nameValid = !form.displayName.trim() || (form.displayName.trim().length >= 2 && form.displayName.trim().length <= 60);

  const submit = async (event) => {
    event.preventDefault();
    if (!dirty || !nameValid) return;
    setSave({ status: 'saving', message: '' });
    try {
      await service.updateTorneosProfile({
        displayName: form.displayName.trim() || null,
        notifyRegistrationRequests: form.notifyRegistrationRequests,
      });
      announceTorneosProfileChanged();
      await profile.reload();
      setSave({ status: 'saved', message: 'Perfil de Torneos guardado.' });
    } catch (error) {
      setSave({ status: 'error', message: error?.message || 'No pudimos guardar tu perfil de Torneos.' });
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      // The common account's own sign-out (the same one Arma2 uses), loaded only when asked for.
      const { signOutWithPushDeactivation } = await import('../../../../services/authLogoutService');
      await signOutWithPushDeactivation({ reason: 'user_logout', force: true });
    } finally {
      setSigningOut(false);
    }
  };

  const channels = profile.profile?.channels || { inbox: true, push: false, email: false };

  return (
    <div className={styles.page}>
      <header className={styles.pageHero}>
        <span className={styles.kicker}><UserRound size={15} aria-hidden="true" /> Mi perfil de Torneos</span>
        <h1>{profile.displayName}</h1>
        <p>Cómo te ven las organizaciones y qué avisos de Torneos recibís. Tu perfil deportivo de Arma2 no cambia.</p>
      </header>

      {!profile.supported ? (
        <section className={styles.profileSection}>
          <p className={styles.help}>
            El perfil propio de Torneos no está disponible en esta versión. Usamos el nombre de tu cuenta: {profile.fallbackName || '—'}.
          </p>
        </section>
      ) : (
        <form className={styles.profileSection} onSubmit={submit} aria-labelledby="profile-identity-title">
          <header>
            <h2 id="profile-identity-title"><ShieldCheck size={18} aria-hidden="true" /> Nombre de presentación</h2>
            <p>
              Lo ven las organizaciones en tus solicitudes y en sus avisos. No cambia tu nombre en Arma2 ni los nombres
              oficiales de planteles y actas.
            </p>
          </header>
          <label className={styles.field}>
            <span>Nombre en Torneos</span>
            <input
              value={form.displayName}
              maxLength={60}
              placeholder={profile.fallbackName || 'Tu nombre'}
              aria-invalid={!nameValid}
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
            />
          </label>
          {profile.usesFallback && profile.fallbackName && (
            <p className={styles.help}>Mientras no elijas uno, mostramos el nombre de tu cuenta: {profile.fallbackName}.</p>
          )}

          <div className={styles.profileSubsection} aria-labelledby="profile-notifications-title">
            <h3 id="profile-notifications-title"><Bell size={16} aria-hidden="true" /> Avisos</h3>
            <ul className={styles.channelList}>
              <li data-active={channels.inbox ? 'true' : 'false'}><strong>Bandeja de Torneos</strong><span>{channels.inbox ? 'Activa' : 'No disponible'}</span></li>
              <li data-active={channels.push ? 'true' : 'false'}><strong>Notificaciones push</strong><span>{channels.push ? 'Activas' : 'Todavía no disponibles en Torneos'}</span></li>
              <li data-active={channels.email ? 'true' : 'false'}><strong>Email</strong><span>{channels.email ? 'Activo' : 'Todavía no disponible en Torneos'}</span></li>
            </ul>
            <p className={styles.help}>
              Los resultados de tus solicitudes y los comunicados oficiales de tus torneos siempre llegan a la bandeja.
            </p>
            {profile.profile?.reviewsRegistrations && (
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={form.notifyRegistrationRequests}
                  onChange={(event) => setForm((current) => ({ ...current, notifyRegistrationRequests: event.target.checked }))}
                />
                <span>Avisarme en la bandeja cuando un equipo envía una solicitud a un torneo que gestiono</span>
              </label>
            )}
          </div>

          {save.status === 'error' && <p className={styles.errorText} role="alert"><AlertCircle size={16} aria-hidden="true" /> {save.message}</p>}
          {save.status === 'saved' && !dirty && <p className={styles.successNotice} role="status"><CheckCircle2 size={16} aria-hidden="true" /> {save.message}</p>}
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryAction} disabled={!dirty || !nameValid || save.status === 'saving'}>
              {save.status === 'saving' ? <Loader2 className={styles.spin} size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
              Guardar
            </button>
          </div>
        </form>
      )}

      <RelationsSection />

      <section className={`${styles.profileSection} ${styles.accountSection}`} aria-labelledby="profile-account-title">
        <header>
          <h2 id="profile-account-title"><KeyRound size={18} aria-hidden="true" /> Cuenta Arma2</h2>
          <p>Tu cuenta es la misma en Arma2 y en Torneos. Estas acciones afectan a toda la cuenta, no sólo a Torneos.</p>
        </header>
        <dl className={styles.accountFacts}>
          <div><dt>Email</dt><dd>{profile.email || '—'}</dd></div>
        </dl>
        <div className={styles.formActions}>
          <button type="button" className={styles.secondaryAction} disabled={signingOut} onClick={signOut}>
            {signingOut ? <Loader2 className={styles.spin} size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
            Cerrar sesión
          </button>
          <Link className={styles.textAction} to="/account-deletion">Cómo eliminar la cuenta</Link>
        </div>
      </section>
    </div>
  );
}
