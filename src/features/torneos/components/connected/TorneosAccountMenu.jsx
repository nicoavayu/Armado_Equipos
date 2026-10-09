import React, { useEffect, useRef, useState } from 'react';
import { Bell, Compass, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { firstName } from '../../../../utils/displayName';
import { useTorneosFeatures } from '../../context/TorneosFeaturesContext';
import { useTorneosProfile } from './useTorneosProfile';
import headerStyles from '../../../../components/global-header/GlobalHeader.module.css';
import TorneosWordmark from '../../../../assets/branding/arma2-torneos.png';
import styles from './ConnectedProduct.module.css';

// The account menu of Torneos. It shows the Torneos presentation name and opens Torneos destinations only: no Core
// availability (that is about Core match invitations), no Core awards or stories, no Core profile. Switching product
// is the space selector's job, never a side effect of opening the profile.
export default function TorneosAccountMenu() {
  const navigate = useNavigate();
  const features = useTorneosFeatures();
  const { displayName, avatarUrl, email } = useTorneosProfile();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const greeting = firstName(displayName, 'Hola');
  const initial = (displayName || '?').charAt(0).toUpperCase();

  const close = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('button')?.focus();
    const handleOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) close({ restoreFocus: false });
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const go = (path) => {
    close({ restoreFocus: false });
    navigate(path);
  };

  const actions = [
    {
      path: '/torneos/perfil',
      icon: UserRound,
      // Only here the word is the official wordmark; its alt keeps the full name «Mi perfil de Torneos».
      title: (
        <>
          Mi perfil de{' '}
          <img className={styles.inlineWordmark} src={TorneosWordmark} alt="Torneos" width="696" height="111" />
        </>
      ),
      copy: 'Tu nombre en Torneos, tus vínculos y tus avisos',
    },
    { path: '/torneos/avisos', icon: Bell, title: 'Avisos de Torneos', copy: 'Comunicados y novedades de tus inscripciones' },
    ...(features.tournament_catalog === false ? [] : [
      { path: '/torneos/explorar', icon: Compass, title: 'Explorar torneos', copy: 'Convocatorias abiertas para tu equipo' },
    ]),
  ];

  return (
    <div className={headerStyles.avatarMenuRoot} ref={containerRef} data-torneos-account-menu="true">
      <button
        ref={triggerRef}
        className={headerStyles.avatarTrigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Abrir tu cuenta de Torneos"
        onClick={() => setOpen(true)}
      >
        <span className={headerStyles.avatarImage}>
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initial}</span>}
        </span>
      </button>

      {open && (
        <section
          ref={menuRef}
          className={headerStyles.avatarMenu}
          role="dialog"
          aria-modal="false"
          aria-labelledby="torneos-account-menu-title"
        >
          <div className={headerStyles.avatarMenuHeading}>
            <div>
              <span>Hola, {greeting}</span>
              <h2 id="torneos-account-menu-title">{displayName}</h2>
              {email ? <small>{email}</small> : null}
            </div>
            <button type="button" className={headerStyles.closeButton} aria-label="Cerrar tu cuenta de Torneos" onClick={() => close()}>
              <X size={18} />
            </button>
          </div>
          <div className={headerStyles.avatarMenuBody}>
            <div className={headerStyles.avatarActions}>
              {actions.map(({ path, icon: Icon, title, copy }) => (
                <button key={path} type="button" onClick={() => go(path)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{title}</strong>
                    <small>{copy}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
