-- ---------------------------------------------------------------------------
-- Las reglas de negocio de los flujos core son condiciones del cliente
-- ---------------------------------------------------------------------------
-- Cierre del barrido de `55000` sobre las rutas RPC que el organizador ejecuta
-- desde la interfaz en los flujos certificados del ciclo de vida.
--
-- Las seis correcciones anteriores cerraron una condición cada una. El barrido
-- posterior mostró que quedaban cinco códigos más de la misma clase, todos
-- alcanzables por el propietario apretando botones que la interfaz le ofrece:
--
--   TORNEOS_STANDINGS_DRAFT_EXISTS      «Recalcular» dos veces sin cambios.
--   TORNEOS_STANDINGS_STALE             publicar con resultados ya cambiados.
--   TORNEOS_STANDINGS_NOT_PUBLISHABLE   publicar una revisión que ya no lo es.
--   TORNEOS_MATCH_OPERATION_ACTIVE      postergar/cancelar con acta viva.
--   TORNEOS_MATCH_NOT_OPENABLE          abrir el acta de un partido que no la admite.
--
-- Las cinco son situaciones previstas por el contrato y resolubles por el
-- organizador: recalcular de nuevo, cerrar el acta, elegir otro partido.
-- Ninguna es una falla del servidor, y presentarlas como HTTP 500 deja al
-- usuario sin salida y ensucia la señal de errores reales.
--
-- Ninguna regla cambia. Los guards siguen rechazando exactamente lo mismo, con
-- el mismo mensaje de contrato y el mismo `detail`. Cambia sólo de quién es el
-- error: `55000` (que PostgREST devuelve como 500) pasa a `22023`, como en el
-- resto del módulo.
--
-- El parche recorre las definiciones vivas y reescribe únicamente el SQLSTATE de
-- estos cinco mensajes. Es idempotente —una segunda pasada no toca nada— y
-- fail-closed: al final verifica que ninguno de los cinco códigos siga en la
-- clase 55 y aborta si queda alguno.

do $core_flow_business_rules_are_client_errors$
declare
  v_codes constant text[] := array[
    'TORNEOS_STANDINGS_DRAFT_EXISTS',
    'TORNEOS_STANDINGS_STALE',
    'TORNEOS_STANDINGS_NOT_PUBLISHABLE',
    'TORNEOS_MATCH_OPERATION_ACTIVE',
    'TORNEOS_MATCH_NOT_OPENABLE'
  ];
  v_function record;
  v_code text;
  v_source text;
  v_new text;
  v_leftover text;
begin
  for v_function in
    select oid, proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and prokind = 'f'
      and pg_get_functiondef(oid) like '%55000%'
    order by proname
  loop
    v_source := pg_get_functiondef(v_function.oid);
    v_new := v_source;

    foreach v_code in array v_codes loop
      -- Sólo el SQLSTATE de este mensaje. El resto del cuerpo queda intacto,
      -- incluidos los `55000` de códigos que no son de este alcance.
      v_new := regexp_replace(
        v_new,
        format(
          $re$(raise exception using errcode = )'55000'(,[[:space:]]*message = '%s')$re$,
          v_code
        ),
        $rep$\1'22023'\2$rep$,
        'g'
      );
    end loop;

    if v_new <> v_source then
      execute v_new;
    end if;
  end loop;

  -- Postcondición: ninguno de los cinco puede seguir siendo un 500. Si alguna
  -- definición no era la que este parche sabe leer, se ve acá y aborta.
  select string_agg(distinct p.proname || ' / ' || c.code, ', ')
  into v_leftover
  from pg_proc p
  cross join unnest(v_codes) as c(code)
  where p.pronamespace = 'public'::regnamespace
    and pg_get_functiondef(p.oid) ~ (
      format($re$raise exception using errcode = '55000',[[:space:]]*message = '%s'$re$, c.code)
    );

  if v_leftover is not null then
    raise exception 'quedaron reglas de negocio en la clase 55: %', v_leftover;
  end if;
end;
$core_flow_business_rules_are_client_errors$;

-- Ninguna de las cinco reglas cambió de alcance; sí cambió cómo se comunican.
COMMENT ON FUNCTION "public"."rebuild_tournament_standings"("uuid", "uuid", "uuid", "uuid", "uuid", "text", "uuid") IS
  'Recalcula la tabla y devuelve una revisión borrador reproducible. Volver a recalcular sin que las fuentes hayan cambiado se responde como error del cliente: el borrador vigente ya refleja esos datos.';

COMMENT ON FUNCTION "public"."publish_tournament_standings_revision"("uuid", "text") IS
  'Publica una revisión borrador de la tabla. Que la revisión ya no sea publicable o que los resultados oficiales hayan cambiado durante el cálculo se responden como errores del cliente: el organizador recalcula y vuelve a publicar.';

COMMENT ON FUNCTION "public"."protect_tournament_match_planning_transition"() IS
  'Un partido con acta viva no puede postergarse, cancelarse ni volver a sin programar: primero hay que resolver o anular el acta. El rechazo se comunica como error del cliente.';

COMMENT ON FUNCTION "public"."open_tournament_match_operation"("uuid", "uuid", "text") IS
  'Abre el acta de un partido. Hasta seis horas antes del horario programado la apertura es directa; más temprano exige un motivo en `p_override_reason`. Un partido que no reúne las condiciones para tener acta, y uno con resultado ya oficializado, se responden como errores del cliente. Ninguna de esas negativas es una falla del servidor.';
