import React, { useEffect, useRef, useState } from 'react';
import { Check, CircleUserRound, Gift, LoaderCircle, X } from 'lucide-react';
import logger from '../../utils/logger';
import { useAuth } from '../AuthProvider';
import { addFreePlayer, removeFreePlayer, updateProfile } from '../../supabase';
import { firstName } from '../../utils/displayName';
import { APP_SPACE, useSpaceNavigation } from '../../features/space-navigation';
import { useAwardsStory } from './AwardsStoryContext';
import styles from './GlobalHeader.module.css';

export default function UserAvatarMenu() {
  const { user, profile, refreshProfile } = useAuth();
  const { switchSpace } = useSpaceNavigation();
  const awardsStory = useAwardsStory();
  const [open, setOpen] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const displayName = profile?.nombre?.trim() || user?.email?.split('@')[0] || 'Usuario';
  const greetingName = firstName(displayName, 'Usuario');
  const isAvailable = profile?.acepta_invitaciones !== false;
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const initial = displayName.charAt(0).toUpperCase() || '?';
  const availabilityOptions = [
    {
      value: true,
      label: 'Disponible',
      description: 'Aparecés en Jugadores y podés recibir nuevas invitaciones para jugar.',
    },
    {
      value: false,
      label: 'No disponible',
      description: 'No aparecés en Jugadores ni recibís nuevas invitaciones mientras esté activo.',
    },
  ];

  const close = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    setAvailabilityError('');
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

  const changeAvailability = async (nextValue) => {
    if (!user?.id || nextValue === isAvailable || savingAvailability) return;
    setSavingAvailability(true);
    setAvailabilityError('');
    try {
      await updateProfile(user.id, { acepta_invitaciones: nextValue });
      if (nextValue) {
        try {
          await addFreePlayer();
        } catch (error) {
          if (!/ya est[aá]s anotado como disponible/i.test(String(error?.message || ''))) throw error;
        }
      } else {
        await removeFreePlayer();
      }
      await refreshProfile();
    } catch (error) {
      logger.error('Error updating availability status:', error);
      setAvailabilityError('No pudimos actualizar tu disponibilidad. Probá de nuevo.');
    } finally {
      setSavingAvailability(false);
    }
  };

  const openProfile = () => {
    close({ restoreFocus: false });
    switchSpace(APP_SPACE.ARMA2, { route: '/profile' });
  };

  const openAwards = async () => {
    close({ restoreFocus: false });
    await awardsStory.openLatestStory();
  };

  return (
    <div className={styles.avatarMenuRoot} ref={containerRef}>
      <button
        ref={triggerRef}
        className={`${styles.avatarTrigger} ${awardsStory.hasStory ? styles.avatarHasStory : ''} ${awardsStory.hasPendingStory ? styles.avatarPendingStory : ''}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Abrir menú de usuario"
        onClick={() => setOpen(true)}
      >
        <span className={styles.avatarImage}>
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initial}</span>}
        </span>
        <span className={`${styles.availabilityDot} ${isAvailable ? styles.available : styles.unavailable}`} aria-hidden="true" />
      </button>

      {open && (
        <section
          ref={menuRef}
          className={styles.avatarMenu}
          role="dialog"
          aria-modal="false"
          aria-labelledby="avatar-menu-title"
        >
          <div className={styles.avatarMenuHeading}>
            <div>
              <span>Hola, {greetingName}</span>
              <h2 id="avatar-menu-title">{displayName}</h2>
              {profile?.nombre && user?.email ? <small>{user.email}</small> : null}
            </div>
            <button type="button" className={styles.closeButton} aria-label="Cerrar menú de usuario" onClick={close}>
              <X size={18} />
            </button>
          </div>

          <div className={styles.avatarMenuBody}>
            <div className={styles.availabilityHeading}>
              <span>Disponibilidad</span>
              {savingAvailability && <LoaderCircle className={styles.spinner} size={15} aria-label="Guardando" />}
            </div>
            <div className={styles.availabilityOptions}>
              {availabilityOptions.map((option) => {
                const active = isAvailable === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={active ? styles.availabilityActive : ''}
                    aria-pressed={active}
                    disabled={savingAvailability}
                    onClick={() => changeAvailability(option.value)}
                  >
                    <span className={`${styles.statusDot} ${option.value ? styles.available : styles.unavailable}`} />
                    <span className={styles.availabilityOptionCopy}>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {active && <Check size={14} />}
                  </button>
                );
              })}
            </div>
            {availabilityError && <p className={styles.menuError} role="alert">{availabilityError}</p>}

            <div className={styles.avatarActions}>
              {awardsStory.hasStory && (
                <button type="button" onClick={openAwards}>
                  <Gift size={18} />
                  <span>
                    <strong>{awardsStory.hasPendingStory ? 'Ver nuevos premios' : 'Volver a ver premios'}</strong>
                    <small>Historia de tu último partido</small>
                  </span>
                </button>
              )}
              <button type="button" onClick={openProfile}>
                <CircleUserRound size={18} />
                <span>
                  <strong>Perfil</strong>
                  <small>Ver y editar cómo aparecés en Arma2</small>
                </span>
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
