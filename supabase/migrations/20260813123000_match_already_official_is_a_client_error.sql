-- ---------------------------------------------------------------------------
-- Un acta ya oficializada es una condición esperable, no un error interno
-- ---------------------------------------------------------------------------
-- Quinto y último `55000` del recorrido de apertura del acta.
--
-- `open_tournament_match_operation` rechaza abrir un acta nueva cuando el
-- partido ya tiene una versión `official`. La regla es correcta y no se toca:
-- una vez oficializado el resultado, la única vía para modificarlo es el
-- circuito de corrección, que crea otra versión con su propia trazabilidad.
--
-- El defecto era cómo se comunicaba. La regla levantaba `55000`
-- (`object_not_in_prerequisite_state`), que PostgREST devuelve como HTTP 500.
-- El organizador toca «Abrir acta» en un partido ya cerrado —algo que hace
-- naturalmente, porque el botón está ahí— y recibe una falla del servidor en
-- lugar de la explicación de que el resultado ya está oficializado y de cuál es
-- el camino para corregirlo.
--
-- Pasa a `22023` (`invalid_parameter_value`), que PostgREST devuelve como 400,
-- exactamente igual que las cinco reglas ya corregidas en
-- `20260813121000_match_open_window_is_a_client_error.sql` y
-- `20260813122000_lifecycle_business_rules_are_client_errors.sql`. El mensaje de
-- contrato no cambia, así que `ERROR_MESSAGES` ya lo traduce sin tocar el
-- cliente: «El partido ya tiene un resultado oficial. Solicitá una corrección
-- para crear otra versión.»
--
-- El parche es textual sobre la definición viva, idempotente y fail-closed: si
-- la definición no es la que este parche sabe leer, aborta en lugar de
-- reescribir algo distinto de lo esperado.

do $match_already_official_is_a_client_error$
declare
  v_source text;
  v_patched text;
  v_old constant text := $old$    raise exception using errcode = '55000',
      message = 'TORNEOS_MATCH_ALREADY_OFFICIAL';$old$;
  v_new constant text := $new$    raise exception using errcode = '22023',
      message = 'TORNEOS_MATCH_ALREADY_OFFICIAL';$new$;
begin
  select pg_get_functiondef(oid) into v_source
  from pg_proc
  where proname = 'open_tournament_match_operation'
    and pronamespace = 'public'::regnamespace;

  if v_source is null then
    raise exception 'open_tournament_match_operation not found';
  end if;

  if position(v_new in v_source) > 0 then
    return; -- ya corregido: la migración es idempotente
  end if;

  if position(v_old in v_source) = 0 then
    raise exception
      'TORNEOS_MATCH_ALREADY_OFFICIAL anchor not found; refusing to patch a definition we do not recognise';
  end if;

  v_patched := replace(v_source, v_old, v_new);
  execute v_patched;
end;
$match_already_official_is_a_client_error$;

COMMENT ON FUNCTION "public"."open_tournament_match_operation"("uuid", "uuid", "text") IS
  'Abre el acta de un partido. Hasta seis horas antes del horario programado la apertura es directa; más temprano exige un motivo en `p_override_reason`. Un partido con resultado ya oficializado no admite un acta nueva: se responde como error del cliente e indica que la corrección es el camino. Ninguna de las dos negativas es una falla del servidor.';
