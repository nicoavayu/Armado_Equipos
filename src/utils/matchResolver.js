import logger from './logger';
import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/utils/matchResolver.js
import { supabase } from '../supabase';

const IS_DEV = process.env.NODE_ENV === 'development';
export const MATCH_RESOLUTION_STATUS = Object.freeze({
    OK: 'ok',
    MISSING_PARAMS: 'missingParams',
    INVALID_PARAMS: 'invalidParams',
    NOT_FOUND: 'notFound',
    ERROR: 'error',
});

const EXPECTED_STATUSES = new Set([
    MATCH_RESOLUTION_STATUS.MISSING_PARAMS,
    MATCH_RESOLUTION_STATUS.INVALID_PARAMS,
    MATCH_RESOLUTION_STATUS.NOT_FOUND,
]);

const createResolutionResult = ({
    partidoId = null,
    error = null,
    source = null,
    status = MATCH_RESOLUTION_STATUS.OK,
    shouldReport = false,
    cause = null,
    context = {},
} = {}) => ({
    partidoId,
    error,
    source,
    status,
    shouldReport,
    cause,
    context,
});

const createExpectedResolution = (status, error, extras = {}) => createResolutionResult({
    status,
    error,
    shouldReport: false,
    ...extras,
});

const createReportableResolution = (error, cause, extras = {}) => createResolutionResult({
    status: MATCH_RESOLUTION_STATUS.ERROR,
    error,
    shouldReport: true,
    cause,
    ...extras,
});

export const isExpectedMatchResolution = (resolution) => (
    Boolean(resolution)
    && resolution.shouldReport === false
    && EXPECTED_STATUSES.has(resolution.status)
);

const toError = (value, fallbackMessage = 'Unexpected voting error') => {
    if (value instanceof Error) return value;
    const message = String(value?.message || value || fallbackMessage).trim() || fallbackMessage;
    const error = new Error(message);
    if (value?.code) error.code = value.code;
    return error;
};

const parsePartidoId = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return null;
    return Math.abs(id);
};

const getCodeContext = (codigo) => ({
    has_codigo: Boolean(codigo),
    codigo_length: String(codigo || '').length,
});

const isMissingColumnError = (error) => {
    const code = String(error?.code || '').trim();
    if (code === '42703') return true;
    const message = String(error?.message || '').toLowerCase();
    return message.includes('column') && (message.includes('does not exist') || message.includes('no existe'));
};

const fetchMatchPlayers = async (partidoId) => {
    const candidateSelects = [
        'id, uuid, nombre, avatar_url, usuario_id, score, is_goalkeeper, is_substitute',
        'id, uuid, nombre, avatar_url, usuario_id, score, is_goalkeeper',
        'id, uuid, nombre, avatar_url, usuario_id',
    ];

    let lastError = null;

    for (const selectClause of candidateSelects) {
        const { data, error } = await supabase
            .from('jugadores')
            .select(selectClause)
            .eq('partido_id', partidoId);

        if (!error) {
            return { data: data || [], error: null };
        }

        lastError = error;
        if (!isMissingColumnError(error)) {
            return { data: null, error };
        }
    }

    return { data: null, error: lastError };
};

/**
 * Resolves match ID from query parameters
 * Priority: partidoId > codigo
 * 
 * @param {URLSearchParams} params - URL search params
 * @returns {Promise<{ partidoId: number|null, error: string|null, source: 'partidoId'|'codigo'|null, status: string, shouldReport: boolean, cause?: Error|null }>}
 */
export async function resolveMatchIdFromQueryParams(params) {
    const partidoIdParam = params.get('partidoId');
    const codigoParam = params.get('codigo') || params.get('CODIGO');

    if (IS_DEV) {
        logger.log('[VOTING] Resolving match with params:', { partidoIdParam, codigoParam });
    }

    // No parameters provided
    if (!partidoIdParam && !codigoParam) {
        return createExpectedResolution(
            MATCH_RESOLUTION_STATUS.MISSING_PARAMS,
            'El link de votación no tiene código de partido.',
        );
    }

    // Priority 1: Use partidoId directly
    if (partidoIdParam) {
        const partidoId = parsePartidoId(partidoIdParam);
        if (!partidoId) {
            return createExpectedResolution(
                MATCH_RESOLUTION_STATUS.INVALID_PARAMS,
                'El link de votación no es válido.',
                { source: 'partidoId' },
            );
        }
        if (IS_DEV) {
            logger.log('[VOTING] Using partidoId:', partidoId);
        }
        return createResolutionResult({ partidoId, error: null, source: 'partidoId' });
    }

    // Priority 2: Resolve codigo to partidoId
    if (codigoParam) {
        // Defensive parse: keep only the first code-like token in case the URL
        // was pasted together with extra text (e.g. "ABC123 Votá para...").
        const rawCodigo = String(codigoParam || '').trim();
        const token = rawCodigo.match(/[A-Za-z0-9]+/)?.[0] || '';
        const codigo = token.toUpperCase();
        if (!codigo) {
            return createExpectedResolution(
                MATCH_RESOLUTION_STATUS.INVALID_PARAMS,
                'Ingresá un código de partido para votar.',
                { source: 'codigo' },
            );
        }

        if (IS_DEV) {
            logger.log('[VOTING] Resolving codigo:', codigo);
        }

        try {
            // Preferred path: SECURITY DEFINER RPC (works for anon/public links)
            const { data: rpcId, error: rpcError } = await supabase.rpc('resolve_match_by_code', {
                p_codigo: codigo,
            });

            if (!rpcError && rpcId) {
                const partidoId = parsePartidoId(rpcId);
                if (partidoId) {
                    if (IS_DEV) {
                        logger.log('[VOTING] Resolved codigo -> partidoId via RPC:', partidoId);
                    }
                    return createResolutionResult({ partidoId, error: null, source: 'codigo' });
                }
                return createReportableResolution(
                    'No pudimos validar el código del partido. Intentá de nuevo en unos minutos.',
                    new Error('Invalid match id returned by resolve_match_by_code'),
                    {
                        source: 'codigo',
                        context: {
                            action: 'resolve_match_by_code',
                            response_source: 'rpc',
                            ...getCodeContext(codigo),
                        },
                    },
                );
            }

            // Fallback 1: partidos_view (if readable in current environment)
            const { data: viewRow, error: viewError } = await supabase
                .from('partidos_view')
                .select('id')
                .ilike('codigo', codigo)
                .maybeSingle();

            if (!viewError && viewRow?.id) {
                const partidoId = parsePartidoId(viewRow.id);
                if (partidoId) {
                    if (IS_DEV) {
                        logger.log('[VOTING] Resolved codigo -> partidoId via partidos_view:', partidoId);
                    }
                    return createResolutionResult({ partidoId, error: null, source: 'codigo' });
                }
                return createReportableResolution(
                    'No pudimos validar el código del partido. Intentá de nuevo en unos minutos.',
                    new Error('Invalid match id returned by partidos_view'),
                    {
                        source: 'codigo',
                        context: {
                            action: 'resolve_match_by_code',
                            response_source: 'partidos_view',
                            ...getCodeContext(codigo),
                        },
                    },
                );
            }

            // Fallback 2: direct table lookup (may fail on anon RLS in some envs)
            const { data: directRow, error: directError } = await supabase
                .from('partidos')
                .select('id')
                .ilike('codigo', codigo)
                .maybeSingle();

            if (!directError && directRow?.id) {
                const partidoId = parsePartidoId(directRow.id);
                if (partidoId) {
                    if (IS_DEV) {
                        logger.log('[VOTING] Resolved codigo -> partidoId via partidos:', partidoId);
                    }
                    return createResolutionResult({ partidoId, error: null, source: 'codigo' });
                }
                return createReportableResolution(
                    'No pudimos validar el código del partido. Intentá de nuevo en unos minutos.',
                    new Error('Invalid match id returned by partidos'),
                    {
                        source: 'codigo',
                        context: {
                            action: 'resolve_match_by_code',
                            response_source: 'partidos',
                            ...getCodeContext(codigo),
                        },
                    },
                );
            }

            const successfulEmptyLookup = !rpcError || !viewError || !directError;

            if (IS_DEV) {
                logger.warn('[VOTING] resolve by codigo details:', {
                    rpcError,
                    viewError,
                    directError,
                    codigo,
                });
            }
            if (!rpcId && !viewRow?.id && !directRow?.id) {
                if (successfulEmptyLookup) {
                    if (IS_DEV) {
                        logger.warn('[VOTING] No match found for codigo:', codigo);
                    }
                    return createExpectedResolution(
                        MATCH_RESOLUTION_STATUS.NOT_FOUND,
                        'No encontramos ese partido. Revisá el código o pedí un link nuevo.',
                        {
                            source: 'codigo',
                            context: getCodeContext(codigo),
                        },
                    );
                }

                const cause = toError(rpcError || viewError || directError, 'No successful lookup while resolving match code');
                return createReportableResolution(
                    'No pudimos validar el código del partido. Intentá de nuevo en unos minutos.',
                    cause,
                    {
                        source: 'codigo',
                        context: {
                            action: 'resolve_match_by_code',
                            ...getCodeContext(codigo),
                        },
                    },
                );
            }
            return createReportableResolution(
                'No pudimos validar el código del partido. Intentá de nuevo en unos minutos.',
                new Error('Unexpected match code resolution state'),
                {
                    source: 'codigo',
                    context: {
                        action: 'resolve_match_by_code',
                        ...getCodeContext(codigo),
                    },
                },
            );
        } catch (error) {
            logger.error('[VOTING] Error resolving codigo:', error);
            return createReportableResolution(
                'No pudimos validar el código del partido. Intentá de nuevo en unos minutos.',
                toError(error, 'Error resolving match code'),
                {
                    source: 'codigo',
                    context: {
                        action: 'resolve_match_by_code',
                        ...getCodeContext(codigo),
                    },
                },
            );
        }
    }

    return createReportableResolution(
        'No pudimos cargar la votación.',
        new Error('Unexpected match resolution state'),
    );
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
            logger.error('[VOTING] Error fetching match by ID:', error);
            return {
                partido: null,
                error: 'No se pudo cargar el partido',
                status: MATCH_RESOLUTION_STATUS.ERROR,
                shouldReport: true,
                cause: toError(error || 'Match row missing after resolving ID', 'Error fetching match by ID'),
                context: {
                    action: 'fetch_match_by_id',
                    match_id: partidoId,
                },
            };
        }

        // Ensure voting flow always has numeric player IDs (required by public vote RPCs)
        const { data: jugadoresData, error: jugadoresError } = await fetchMatchPlayers(partidoId);

        if (jugadoresError) {
            logger.warn('[VOTING] Could not fetch jugadores table for match:', {
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
            logger.log('[VOTING] Match loaded:', {
                id: partido.id,
                jugadoresFromTable: jugadoresData?.length || 0,
                jugadoresFinal: mergedPartido.jugadores?.length || 0,
            });
        }
        return { partido: mergedPartido, error: null, status: MATCH_RESOLUTION_STATUS.OK, shouldReport: false };
    } catch (err) {
        logger.error('[VOTING] Exception fetching match:', err);
        return {
            partido: null,
            error: 'Error al cargar el partido',
            status: MATCH_RESOLUTION_STATUS.ERROR,
            shouldReport: true,
            cause: toError(err, 'Exception fetching match'),
            context: {
                action: 'fetch_match_by_id',
                match_id: partidoId,
            },
        };
    }
}

/**
 * Handle match resolution error with user feedback
 * @param {string} error - Error message
 * @param {Function} navigate - Navigate function (optional)
 */
export function handleMatchResolutionError(error, navigate = null) {
    const resolution = typeof error === 'object' && error !== null
        ? error
        : createReportableResolution(
            String(error || 'No se pudo cargar el partido'),
            toError(error || 'No se pudo cargar el partido'),
        );
    const message = resolution.error || 'No se pudo cargar el partido';

    if (isExpectedMatchResolution(resolution)) {
        if (IS_DEV) {
            logger.warn('[VOTING] Match resolution expected state:', {
                status: resolution.status,
                source: resolution.source,
            });
        }
    } else {
        const cause = toError(resolution.cause || message, message);
        const {
            action,
            match_id,
            ...safeContext
        } = resolution.context || {};
        logger.error('[VOTING] Match resolution error:', {
            message,
            status: resolution.status,
            source: resolution.source,
            cause: cause.message,
        });
        notifyBlockingError(message, {
            screen: 'public_voting',
            action: action || 'match_resolution',
            match_id,
            error: cause,
            title: 'No se pudo cargar la votación',
            danger: true,
            extra: {
                status: resolution.status,
                source: resolution.source,
                ...safeContext,
            },
        });
    }

    if (navigate) {
        setTimeout(() => {
            navigate('/');
        }, 2000);
    }
}
