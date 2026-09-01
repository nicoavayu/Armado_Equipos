import React, { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, Users } from 'lucide-react';
import styles from './TeamRegistration.module.css';

export default function PlayerAutocomplete({
  onSearch,
  onSelect,
  onCreateProvisional,
  disabled = false,
}) {
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2 || disabled) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const next = await onSearch(normalized);
        if (requestRef.current !== requestId) return;
        setResults(Array.isArray(next) ? next : []);
        setStatus('ready');
      } catch {
        if (requestRef.current !== requestId) return;
        setResults([]);
        setStatus('error');
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [disabled, onSearch, query]);

  return (
    <div className={styles.autocomplete}>
      <label htmlFor="roster-player-search">Buscar jugador de Arma2</label>
      <div className={styles.searchField}>
        <Search size={18} aria-hidden="true" />
        <input
          id="roster-player-search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Escribí al menos 2 letras"
          autoComplete="off"
        />
      </div>
      <div className={styles.searchStatus} role="status" aria-live="polite">
        {status === 'loading' && 'Buscando coincidencias seguras…'}
        {status === 'error' && 'No pudimos buscar. Probá nuevamente.'}
        {status === 'ready' && !results.length && 'No encontramos coincidencias.'}
      </div>
      {results.length > 0 && (
        <div className={styles.searchResults} role="listbox" aria-label="Jugadores encontrados">
          {results.map((player) => (
            <button
              key={player.userId}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => {
                onSelect(player);
                setQuery('');
                setResults([]);
              }}
            >
              <span className={styles.avatar}>
                {player.avatarUrl
                  ? <img src={player.avatarUrl} alt="" />
                  : <Users size={18} aria-hidden="true" />}
              </span>
              <span>
                <strong>{player.displayName}</strong>
                <small>
                  {[player.teamName, player.positions?.join(' · ')]
                    .filter(Boolean).join(' · ') || 'Perfil Arma2'}
                </small>
              </span>
              <em>Vinculado</em>
            </button>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && (
        <button
          type="button"
          className={styles.provisionalAction}
          onClick={() => {
            onCreateProvisional(query.trim());
            setQuery('');
            setResults([]);
          }}
        >
          <UserPlus size={17} />
          Crear “{query.trim()}” sin cuenta
        </button>
      )}
    </div>
  );
}
