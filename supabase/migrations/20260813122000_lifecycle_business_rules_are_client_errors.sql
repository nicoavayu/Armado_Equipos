-- ---------------------------------------------------------------------------
-- Las reglas de negocio del ciclo de vida son condiciones del cliente
-- ---------------------------------------------------------------------------
-- `20260812120000_tournament_competition_lifecycle.sql` comunica trece reglas
-- de negocio. Nueve usan `22023` (`invalid_parameter_value`), que PostgREST
-- devuelve como HTTP 400. Cuatro quedaron en `55000`
-- (`object_not_in_prerequisite_state`), que PostgREST devuelve como HTTP 500.
--
-- Las cuatro son situaciones que el contrato prevé y que el organizador puede
-- resolver por su cuenta: cerrar los partidos que faltan, mirar que el equipo
-- ya figuraba retirado, resolver el acta abierta, o reabrir la competencia.
-- Presentárselas como una falla interna del servidor las vuelve un callejón
-- sin salida, y además borra el dato accionable: el guard de finalización
-- calcula cuántos partidos quedan y ese número nunca llegaba a la pantalla.
--
-- Es el mismo defecto y el mismo criterio de
-- `20260813121000_match_open_window_is_a_client_error.sql`. Ninguna regla
-- cambia: los cuatro guards siguen rechazando exactamente lo mismo, con el
-- mismo mensaje de contrato y el mismo `detail`. Cambia sólo de quién es el
-- error.
--
-- El parche es textual sobre la definición viva, idempotente y fail-closed: si
-- una definición no se reconoce, la migración aborta en lugar de reescribir
-- algo que no es lo que esperaba.

do $lifecycle_business_rules_are_client_errors$
declare
  v_patch record;
  v_source text;
  v_new text;
begin
  for v_patch in
    select *
    from (values
      -- Finalizar con partidos sin resolver. `detail` lleva la cantidad, que es
      -- lo que la interfaz necesita para decir cuántos faltan.
      (
        'finish_tournament_competition',
        $anchor$    raise exception using errcode = '55000',
      message = 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
      detail = v_pending::text;$anchor$,
        $patched$    raise exception using errcode = '22023',
      message = 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
      detail = v_pending::text;$patched$
      ),
      -- Retirar un equipo que ya figura retirado.
      (
        'withdraw_tournament_competition_participant',
        $anchor$    raise exception using errcode = '55000',
      message = 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN';$anchor$,
        $patched$    raise exception using errcode = '22023',
      message = 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN';$patched$
      ),
      -- Retirar un equipo con un acta viva. El retiro sigue sin destruirla.
      (
        'withdraw_tournament_competition_participant',
        $anchor$    raise exception using errcode = '55000',
      message = 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
      detail = v_open_operations::text;$anchor$,
        $patched$    raise exception using errcode = '22023',
      message = 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
      detail = v_open_operations::text;$patched$
      ),
      -- Escribir sobre una competencia Finalizada o Archivada. El guard sigue
      -- rechazando la escritura; deja de disfrazarse de falla del servidor.
      (
        'protect_tournament_completed_competition',
        $anchor$    raise exception using errcode = '55000',
      message = 'TORNEOS_COMPETITION_READ_ONLY';$anchor$,
        $patched$    raise exception using errcode = '22023',
      message = 'TORNEOS_COMPETITION_READ_ONLY';$patched$
      )
    ) as patch(function_name, anchor, patched)
  loop
    select pg_get_functiondef(oid) into v_source
    from pg_proc
    where proname = v_patch.function_name
      and pronamespace = 'public'::regnamespace;

    if v_source is null then
      raise exception 'function % not found', v_patch.function_name;
    end if;

    v_new := replace(v_source, v_patch.anchor, v_patch.patched);

    if v_new = v_source then
      -- Sin cambios: o ya está corregido, o la definición no es la que este
      -- parche sabe leer. Lo segundo aborta.
      if position(v_patch.patched in v_source) = 0 then
        raise exception 'anchor not found in %', v_patch.function_name;
      end if;
      continue;
    end if;

    execute v_new;
  end loop;
end;
$lifecycle_business_rules_are_client_errors$;

-- Ninguna de las cuatro reglas cambió de alcance; sí cambió cómo se comunican.
COMMENT ON FUNCTION "public"."finish_tournament_competition"("uuid", "uuid") IS
  'Finaliza la competencia. Si todavía quedan compromisos abiertos rechaza la operación como error del cliente e informa en el detalle cuántos partidos faltan resolver.';

COMMENT ON FUNCTION "public"."withdraw_tournament_competition_participant"("uuid", "uuid", "uuid", "text", "text") IS
  'Retira un equipo de la competencia. Un equipo ya retirado y un acta todavía abierta se responden como error del cliente: son situaciones previstas que el organizador resuelve, no fallas del servidor.';

COMMENT ON FUNCTION "public"."protect_tournament_completed_competition"() IS
  'Una competencia Finalizada o Archivada no admite operaciones competitivas mutables. Las lecturas, la página pública y los recálculos derivados sobre datos existentes siguen disponibles. El rechazo se comunica como error del cliente: para corregir algo hay que reabrir la competencia.';
