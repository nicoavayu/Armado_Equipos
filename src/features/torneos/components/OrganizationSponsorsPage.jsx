import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Handshake,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { useOptionalTorneosCompetition } from '../context/TorneosCompetitionContext';
import { validateBrandingFile } from '../domain/brandingFiles';
import { SPONSOR_LIMITS, SPONSOR_SORT_ORDER_MAX, validateSponsorName } from '../domain/sponsors';
import OrganizationSettingsNav from './OrganizationSettingsNav';
import PremiumUpsell from './PremiumUpsell';
import shell from './TorneosShell.module.css';
import styles from './OrganizationSponsorsPage.module.css';

// Configuración → Sponsors (PREMIUM SPONSORS, 0020). The organization's sponsors: name + logo, up to 20 active, up to
// three per piece of the Estudio Social. The server decides everything that matters — who may change them (owner and
// administrator), whether the organization has Premium sponsors, what is listed — and this page shows its answer:
// without Premium the rows stay (read-only, they can still be archived) behind the Premium explanation; without the
// organization.update role, read-only.
function sponsorInitials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((word) => word[0]).join('') || 'SP').toUpperCase();
}

function SponsorLogo({ sponsor, previewUrl = '' }) {
  const [failed, setFailed] = useState(false);
  const src = previewUrl || (!failed ? sponsor?.logoUrl : '') || '';
  useEffect(() => { setFailed(false); }, [sponsor?.logoUrl]);
  return (
    <span className={styles.logo} aria-hidden="true">
      {src ? <img src={src} alt="" onError={() => setFailed(true)} /> : <strong>{sponsorInitials(sponsor?.name)}</strong>}
    </span>
  );
}

function SponsorEditor({ sponsor = null, busy, onCancel, onSave }) {
  const inputRef = useRef(null);
  const [name, setName] = useState(sponsor?.name || '');
  const [sortOrder, setSortOrder] = useState(Number.isInteger(sponsor?.sortOrder) ? String(sponsor.sortOrder) : '');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [fileMessage, setFileMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const nameCheck = validateSponsorName(name);
  const orderValue = sortOrder.trim() === '' ? null : Number(sortOrder);
  const orderValid = orderValue === null || (Number.isInteger(orderValue) && orderValue >= 0 && orderValue <= SPONSOR_SORT_ORDER_MAX);
  const needsLogo = !sponsor?.logoPath && !file;
  const fieldId = sponsor ? `sponsor-${sponsor.id}` : 'sponsor-new';

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const choose = (selected) => {
    if (!selected) return;
    const validation = validateBrandingFile(selected);
    if (!validation.valid) {
      setFileMessage(validation.message);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFileMessage('');
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  };

  const submit = (event) => {
    event.preventDefault();
    setTouched(true);
    if (busy || !nameCheck.valid || !orderValid || needsLogo) return;
    onSave({ name: nameCheck.value, file, sortOrder: orderValue });
  };

  return (
    <form className={styles.editor} onSubmit={submit} aria-label={sponsor ? `Editar ${sponsor.name}` : 'Nuevo sponsor'}>
      <div className={styles.editorLogo}>
        <SponsorLogo sponsor={sponsor} previewUrl={previewUrl} />
        <div className={styles.editorLogoCopy}>
          <strong>Logo del sponsor</strong>
          <p>PNG, JPEG o WebP · hasta 2 MB al guardar · sin recortes.</p>
          {fileMessage && <span className={shell.fieldError} role="alert">{fileMessage}</span>}
          {!fileMessage && touched && needsLogo && <span className={shell.fieldError} role="alert">Elegí el logo del sponsor.</span>}
        </div>
        <input
          ref={inputRef}
          id={`${fieldId}-logo`}
          className={styles.fileInput}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          aria-label="Elegir logo del sponsor"
          onChange={(event) => choose(event.target.files?.[0])}
        />
        <button type="button" className={styles.secondaryAction} disabled={busy} onClick={() => inputRef.current?.click()}>
          <ImagePlus size={17} aria-hidden="true" />
          {sponsor?.logoPath || file ? 'Cambiar logo' : 'Elegir logo'}
        </button>
      </div>
      <div className={shell.field}>
        <label htmlFor={`${fieldId}-name`}>Nombre</label>
        <input
          id={`${fieldId}-name`}
          value={name}
          maxLength={SPONSOR_LIMITS.nameMaxLength}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        {touched && !nameCheck.valid && <span className={shell.fieldError}>{nameCheck.message}</span>}
      </div>
      <div className={shell.field}>
        <label htmlFor={`${fieldId}-order`}>Orden (opcional)</label>
        <input
          id={`${fieldId}-order`}
          type="number"
          inputMode="numeric"
          min="0"
          max={SPONSOR_SORT_ORDER_MAX}
          placeholder={sponsor ? '' : 'Al final de la lista'}
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          disabled={busy}
        />
        {!orderValid
          ? <span className={shell.fieldError}>El orden tiene que ser un número entre 0 y {SPONSOR_SORT_ORDER_MAX}.</span>
          : <span className={shell.fieldHint}>Los números más bajos van primero en la lista.</span>}
      </div>
      <div className={styles.editorActions}>
        <button type="submit" className={shell.primaryButton} disabled={busy}>
          {busy ? <LoaderCircle className={shell.spinner} size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
          Guardar sponsor
        </button>
        <button type="button" className={shell.secondaryButton} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

export default function OrganizationSponsorsPage() {
  const { organization } = useOutletContext();
  const { service } = useTorneosWorkspace();
  const competition = useOptionalTorneosCompetition();
  const seasonId = competition?.activeSeason?.id || null;
  const organizationId = organization.id;
  const supported = typeof service?.loadOrganizationSponsors === 'function';
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [reload, setReload] = useState(0);
  // null | { mode: 'create' } | { mode: 'edit', sponsor }
  const [editor, setEditor] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });

  useEffect(() => {
    if (!supported) return undefined;
    let active = true;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading', data: null, error: '' }));
    service.loadOrganizationSponsors({ organizationId })
      .then((data) => { if (active) setState({ status: 'ready', data, error: '' }); })
      .catch((error) => {
        if (active) setState({ status: 'error', data: null, error: error?.message || 'No pudimos cargar los sponsors.' });
      });
    return () => { active = false; };
  }, [organizationId, reload, service, supported]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  const save = async ({ name, file, sortOrder }) => {
    const sponsor = editor?.mode === 'edit' ? editor.sponsor : null;
    setBusy('save');
    setNotice({ kind: '', text: '' });
    try {
      await service.saveOrganizationSponsor({
        organizationId,
        sponsorId: sponsor?.id || null,
        name,
        file,
        logoPath: sponsor?.logoPath || null,
        sortOrder,
      });
      setEditor(null);
      setNotice({ kind: 'success', text: sponsor ? `Guardamos los cambios de ${name}.` : `Sumamos a ${name}.` });
      refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error?.message || 'No pudimos guardar el sponsor.' });
      // A sponsor archived elsewhere, the limit reached or Premium gone: the list is read again.
      if (['TORNEOS_SPONSOR_NOT_FOUND', 'TORNEOS_SPONSOR_LIMIT_REACHED', 'TORNEOS_SPONSORS_PREMIUM_REQUIRED', 'TORNEOS_SPONSORS_FORBIDDEN'].includes(error?.code)) refresh();
    } finally {
      setBusy('');
    }
  };

  const archive = async (sponsor) => {
    setBusy(`archive:${sponsor.id}`);
    setNotice({ kind: '', text: '' });
    try {
      await service.archiveOrganizationSponsor({ organizationId, sponsorId: sponsor.id });
      setArchiving(null);
      if (editor?.sponsor?.id === sponsor.id) setEditor(null);
      setNotice({ kind: 'success', text: `Archivamos a ${sponsor.name}. Ya no aparece en el Estudio Social.` });
      refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error?.message || 'No pudimos archivar el sponsor.' });
    } finally {
      setBusy('');
    }
  };

  const header = (
    <header className={shell.pageHeader}>
      <span className={shell.eyebrow}>Organización</span>
      <h1>Configuración</h1>
      <p>Los sponsors de la organización, para sumarlos a las placas del Estudio Social.</p>
    </header>
  );

  if (!supported) {
    return (
      <div className={shell.settingsPage}>
        {header}
        <OrganizationSettingsNav />
        <section className={shell.settingsCard}>
          <p className={styles.muted}>Los sponsors no están disponibles en esta versión de Torneos.</p>
        </section>
      </div>
    );
  }

  const data = state.data;
  const sponsors = data?.sponsors || [];
  const limits = data?.limits || SPONSOR_LIMITS;
  const canManage = data?.canManage === true;
  const entitled = data?.entitled === true;
  const canEdit = canManage && entitled;
  const full = sponsors.length >= limits.maxActive;

  return (
    <div className={shell.settingsPage}>
      {header}
      <OrganizationSettingsNav />

      <section className={shell.settingsCard} aria-labelledby="sponsors-title" aria-busy={state.status === 'loading' || undefined}>
        <div className={styles.titleRow}>
          <div>
            <h2 id="sponsors-title" className={styles.title}>
              <Handshake size={20} aria-hidden="true" /> Sponsors
            </h2>
            {state.status === 'ready' && (
              <p className={styles.limits}>
                {sponsors.length} de {limits.maxActive} sponsors activos · hasta {limits.maxPerExport} por placa
              </p>
            )}
          </div>
          {canEdit && !editor && (
            <button
              type="button"
              className={shell.primaryButton}
              disabled={full || Boolean(busy)}
              onClick={() => { setNotice({ kind: '', text: '' }); setEditor({ mode: 'create' }); }}
            >
              <Plus size={18} aria-hidden="true" /> Agregar sponsor
            </button>
          )}
        </div>

        {state.status === 'loading' && (
          <p className={styles.muted} role="status">
            <LoaderCircle className={shell.spinner} size={16} aria-hidden="true" /> Cargando sponsors…
          </p>
        )}
        {state.status === 'error' && (
          <div className={shell.formError} role="alert">
            {state.error}
            <button type="button" className={styles.linkButton} onClick={refresh}>Reintentar</button>
          </div>
        )}

        {state.status === 'ready' && !canManage && (
          <div className={shell.readOnlyBanner}>
            <LockKeyhole size={18} aria-hidden="true" />
            Modo lectura · Tu rol no permite gestionar los sponsors.
          </div>
        )}

        {state.status === 'ready' && !entitled && (
          <div className={styles.premium}>
            <LockKeyhole size={20} aria-hidden="true" />
            <div>
              <strong>Sponsors es una función Premium.</strong>
              <p>
                Con Premium cargás hasta {limits.maxActive} sponsors con su logo y elegís hasta {limits.maxPerExport} por
                placa en los estilos Premium del Estudio Social (Heritage, Street, Scoreboard y Editorial).
              </p>
              {sponsors.length > 0 && (
                <p>Tus sponsors quedan guardados y vuelven a estar disponibles cuando la temporada tenga Premium.</p>
              )}
              <PremiumUpsell feature="Sponsors" organizationId={organizationId} seasonId={seasonId} />
            </div>
          </div>
        )}

        {state.status === 'ready' && full && canEdit && (
          <p className={shell.fieldHint}>Llegaste al máximo de {limits.maxActive} sponsors activos. Archivá uno para sumar otro.</p>
        )}

        {notice.text && (
          <div className={notice.kind === 'error' ? shell.formError : shell.formSuccess} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.kind === 'success' && <Check size={17} aria-hidden="true" />}
            {notice.text}
          </div>
        )}

        {editor?.mode === 'create' && (
          <SponsorEditor busy={busy === 'save'} onCancel={() => setEditor(null)} onSave={save} />
        )}

        {state.status === 'ready' && (sponsors.length ? (
          <ol className={styles.list} aria-label="Sponsors de la organización">
            {sponsors.map((sponsor, index) => {
              const editing = editor?.mode === 'edit' && editor.sponsor.id === sponsor.id;
              const confirming = archiving === sponsor.id;
              return (
                <li key={sponsor.id} className={styles.item}>
                  {editing ? (
                    <SponsorEditor sponsor={sponsor} busy={busy === 'save'} onCancel={() => setEditor(null)} onSave={save} />
                  ) : (
                    <div className={styles.row}>
                      <span className={styles.order} aria-label={`Posición ${index + 1}`}>{index + 1}</span>
                      <SponsorLogo sponsor={sponsor} />
                      <span className={styles.name}>
                        <strong>{sponsor.name}</strong>
                        {!sponsor.logoPath && <small>Sin logo · no se puede usar en placas</small>}
                      </span>
                      {canManage && !confirming && (
                        <span className={styles.actions}>
                          {entitled && (
                            <button
                              type="button"
                              className={styles.secondaryAction}
                              disabled={Boolean(busy) || Boolean(editor)}
                              onClick={() => { setNotice({ kind: '', text: '' }); setEditor({ mode: 'edit', sponsor }); }}
                              aria-label={`Editar ${sponsor.name}`}
                            >
                              <Pencil size={16} aria-hidden="true" /> Editar
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.secondaryAction} ${styles.danger}`}
                            disabled={Boolean(busy)}
                            onClick={() => { setNotice({ kind: '', text: '' }); setArchiving(sponsor.id); }}
                            aria-label={`Archivar ${sponsor.name}`}
                          >
                            <Archive size={16} aria-hidden="true" /> Archivar
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {confirming && (
                    <div className={styles.confirm} role="group" aria-label={`Confirmar archivo de ${sponsor.name}`}>
                      <p>
                        ¿Archivar a <strong>{sponsor.name}</strong>? Deja de aparecer en el Estudio Social y su logo se
                        elimina. Las placas ya descargadas no cambian.
                      </p>
                      <span className={styles.actions}>
                        <button
                          type="button"
                          className={shell.dangerButton}
                          disabled={Boolean(busy)}
                          onClick={() => archive(sponsor)}
                        >
                          {busy === `archive:${sponsor.id}`
                            ? <LoaderCircle className={shell.spinner} size={17} aria-hidden="true" />
                            : <Archive size={17} aria-hidden="true" />}
                          Confirmar archivo
                        </button>
                        <button type="button" className={shell.secondaryButton} disabled={Boolean(busy)} onClick={() => setArchiving(null)}>
                          Cancelar
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          !editor && <p className={styles.muted}>Todavía no hay sponsors cargados.</p>
        ))}
      </section>
    </div>
  );
}
