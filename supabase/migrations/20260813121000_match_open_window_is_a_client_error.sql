-- ---------------------------------------------------------------------------
-- Abrir el acta antes de tiempo es una condición esperable, no un error interno
-- ---------------------------------------------------------------------------
-- `open_tournament_match_operation` ya contempla la excepción: si faltan más de
-- seis horas para el partido, la apertura se permite siempre que llegue un
-- motivo en `p_override_reason`. El problema era cómo se comunicaba: la regla
-- levantaba `55000`, que PostgREST traduce a HTTP 500. Una condición que el
-- propio contrato prevé —y que el organizador resuelve escribiendo el motivo—
-- se le presentaba como una falla del servidor.
--
-- Pasa a `22023` (`invalid_parameter_value`), que PostgREST devuelve como 400,
-- igual que el resto de las reglas de negocio del módulo. La ventana de seis
-- horas no se toca: sigue siendo la regla canónica, con su misma excepción.

do $match_open_window_is_a_client_error$
declare
  v_source text;
  v_patched text;
  v_old constant text := $old$    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_OPEN_WINDOW';$old$;
  v_new constant text := $new$    raise exception using errcode = '22023', message = 'TORNEOS_MATCH_OPEN_WINDOW';$new$;
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
      'TORNEOS_MATCH_OPEN_WINDOW anchor not found; refusing to patch a definition we do not recognise';
  end if;

  v_patched := replace(v_source, v_old, v_new);
  execute v_patched;
end;
$match_open_window_is_a_client_error$;

COMMENT ON FUNCTION "public"."open_tournament_match_operation"("uuid", "uuid", "text") IS
  'Abre el acta de un partido. Hasta seis horas antes del horario programado la apertura es directa; más temprano exige un motivo en `p_override_reason`, y la falta de ese motivo se responde como error del cliente, no como falla del servidor.';
