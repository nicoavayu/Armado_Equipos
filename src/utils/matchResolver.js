// src/utils/matchResolver.js
import { supabase } from '../supabase';
import { toast } from 'react-toastify';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Resolves match ID from query parameters
 * Priority: partidoId > codigo
 * 
 * @param {URLSearchParams} params - URL search params
 * @returns {Promise<{ partidoId: number|null, error: string|null, source: 'partidoId'|'codigo'|null }>}
 */
export async function resolveMatchIdFromQueryParams(params) {
    const partidoIdParam = params.get('partidoId');
    const codigoParam = params.get('codigo') || params.get('CODIGO');

    if (IS_DEV) {
        console.log('[VOTING] Resolving match with params:', { partidoIdParam, codigoParam });
    }

    // No parameters provided
    if (!partidoIdParam && !codigoParam) {
        return { partidoId: null, error: 'No partidoId or codigo provided', source: null };
    }

    // Priority 1: Use partidoId directly
    if (partidoIdParam) {
        const partidoId = Math.abs(parseInt(partidoIdParam, 10));
        if (isNaN(partidoId) || partidoId <= 0) {
            return { partidoId: null, error: 'Invalid partidoId format', source: null };
        }
        if (IS_DEV) {
            console.log('[VOTING] Using partidoId:', partidoId);
        }
        return { partidoId, error: null, source: 'partidoId' };
    }

    // Priority 2: Resolve codigo to partidoId
    if (codigoParam) {
        // Defensive parse: keep only the first code-like token in case the URL
        // was pasted together with extra text (e.g. "ABC123 Votá para...").
        const rawCodigo = String(codigoParam || '').trim();
        const token = rawCodigo.match(/[A-Za-z0-9]+/)?.[0] || '';
        const codigo = token.toUpperCase();
        if (!codigo) {
            return { partidoId: null, error: 'Empty codigo after trim', source: null };
        }

        if (IS_DEV) {
            console.log('[VOTING] Resolving codigo:', codigo);
        }

        try {
            // Preferred path: SECURITY DEFINER RPC (works for anon/public links)
            const { data: rpcId, error: rpcError } = await supabase.rpc('resolve_match_by_code', {
                p_codigo: codigo,
            });

            if (!rpcError && rpcId) {
                const partidoId = Math.abs(parseInt(rpcId, 10));
                if (!Number.isNaN(partidoId) && partidoId > 0) {
                    if (IS_DEV) {
                        console.log('[VOTING] Resolved codigo -> partidoId via RPC:', partidoId);
                    }
                    return { partidoId, error: null, source: 'codigo' };
                }
            }

            // Fallback 1: partidos_view (if readable in current environment)
            const { data: viewRow, error: viewError } = await supabase
                .from('partidos_view')
                .select('id')
                .ilike('codigo', codigo)
                .maybeSingle();

            if (!viewError && viewRow?.id) {
                const partidoId = Math.abs(parseInt(viewRow.id, 10));
                if (!Number.isNaN(partidoId) && partidoId > 0) {
                    if (IS_DEV) {
                        console.log('[VOTING] Resolved codigo -> partidoId via partidos_view:', partidoId);
                    }
                    return { partidoId, error: null, source: 'codigo' };
                }
            }

            // Fallback 2: direct table lookup (may fail on anon RLS in some envs)
            const { data: directRow, error: directError } = await supabase
                .from('partidos')
                .select('id')
                .ilike('codigo', codigo)
                .maybeSingle();

            if (!directError && directRow?.id) {
                const partidoId = Math.abs(parseInt(directRow.id, 10));
                if (!Number.isNaN(partidoId) && partidoId > 0) {
                    if (IS_DEV) {
                        console.log('[VOTING] Resolved codigo -> partidoId via partidos:', partidoId);
                    }
                    return { partidoId, error: null, source: 'codigo' };
                }
            }

            if (IS_DEV) {
                console.error('[VOTING] resolve by codigo failed details:', {
                    rpcError,
                    viewError,
                    directError,
                    codigo,
                });
            }
            if (!rpcId && !viewRow?.id && !directRow?.id) {
                console.error('[VOTING] No match found for codigo:', codigo);
                return { partidoId: null, error: `No se encontró partido con código: ${codigo}`, source: null };
            }
            return { partidoId: null, error: 'No se pudo resolver el código del partido', source: null };
        } catch (error) {
            console.error('[VOTING] Error resolving codigo:', error);
            return { partidoId: null, error: 'Error al buscar partido por código', source: null };
        }
    }

    return { partidoId: null, error: 'Unexpected state', source: null };
}

/**
 * Fetch match data by ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<{ partido: object|null, error: string|null }>}
 */
export async function fetchMatchById(partidoId) {
    try {
        const { data: partido, error } = await supabase
            .from('partidos_view')
            .select('*')
            .eq('id', partidoId)
            .single();

        if (error || !partido) {
            console.error('[VOTING] Error fetching match by ID:', error);
            return { partido: null, error: 'No se pudo cargar el partido' };
        }

        // Ensure voting flow always has numeric player IDs (required by public vote RPCs)
        const { data: jugadoresData, error: jugadoresError } = await supabase
            .from('jugadores')
            .select('id, uuid, nombre, avatar_url, foto_url, usuario_id, score, is_goalkeeper, is_substitute')
            .eq('partido_id', partidoId);

        if (jugadoresError) {
            console.warn('[VOTING] Could not fetch jugadores table for match:', {
                partidoId,
                error: jugadoresError,
            });
        }

        const mergedPartido = {
            ...partido,
            // Prefer canonical rows from jugadores table when available
            jugadores: Array.isArray(jugadoresData) && jugadoresData.length > 0
                ? jugadoresData
                : (Array.isArray(partido.jugadores) ? partido.jugadores : []),
        };

        if (IS_DEV) {
            console.log('[VOTING] Match loaded:', {
                id: partido.id,
                jugadoresFromTable: jugadoresData?.length || 0,
                jugadoresFinal: mergedPartido.jugadores?.length || 0,
            });
        }
        return { partido: mergedPartido, error: null };
    } catch (err) {
        console.error('[VOTING] Exception fetching match:', err);
        return { partido: null, error: 'Error al cargar el partido' };
    }
}

/**
 * Handle match resolution error with user feedback
 * @param {string} error - Error message
 * @param {Function} navigate - Navigate function (optional)
 */
export function handleMatchResolutionError(error, navigate = null) {
    console.error('[VOTING] Match resolution error:', error);
    toast.error(error || 'No se pudo cargar el partido');

    if (navigate) {
        setTimeout(() => {
            navigate('/');
        }, 2000);
    }
}
