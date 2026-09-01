-- ---------------------------------------------------------------------------
-- El ranking de la tabla tiene que poder correr por PostgREST
-- ---------------------------------------------------------------------------
-- `rank_tournament_standings` actualiza su tabla temporal de trabajo con cinco
-- sentencias que abarcan todas las filas y por eso se escribieron sin `where`.
-- Supabase precarga la librería `safeupdate` en el rol `authenticator`
-- (`session_preload_libraries = supautils, safeupdate`), que rechaza cualquier
-- `UPDATE` sin cláusula `where` con el error `21000`. El resultado es que
-- `rebuild_tournament_standings` —que delega el orden en esta función— falla
-- siempre que se la invoca desde la aplicación, y la tabla de posiciones nunca
-- se puede calcular: por psql funciona, por la API no.
--
-- La corrección agrega el predicado `participant_id is not null` a esas cinco
-- sentencias. `participant_id` es la clave primaria de la tabla temporal, así
-- que el predicado es verdadero para toda fila existente: el conjunto afectado,
-- los valores calculados y el orden resultante son exactamente los mismos. No
-- se toca `safeupdate`, ni la configuración del proyecto, ni ninguna regla de
-- desempate.
--
-- El parche es textual sobre la definición vigente y falla cerrado: si alguno
-- de los cinco anclajes no aparece ni en su forma original ni ya corregida, la
-- migración aborta en lugar de instalar una función a medias.

do $rank_standings_safeupdate_guard$
declare
  v_source text;
  v_patched text;
  v_anchors text[][] := array[
    array[
      $old$        set mini_points = 0, mini_goal_difference = 0, mini_goals_for = 0;$old$,
      $new$        set mini_points = 0, mini_goal_difference = 0, mini_goals_for = 0
        where participant_id is not null;$new$
    ],
    array[
      $old$              'goalsFor', mini_goals_for
            )
          );$old$,
      $new$              'goalsFor', mini_goals_for
            )
          )
        where participant_id is not null;$new$
    ],
    array[
      $old$      set criterion_value = 0;$old$,
      $new$      set criterion_value = 0
      where work.participant_id is not null;$new$
    ],
    array[
      $old$        trace = trace || jsonb_build_object(v_rule.criterion, criterion_value);$old$,
      $new$        trace = trace || jsonb_build_object(v_rule.criterion, criterion_value)
    where participant_id is not null;$new$
    ],
    array[
      $old$        'seedPurpose', 'Orden visual estable hasta resolver el empate manual.'
      );$old$,
      $new$        'seedPurpose', 'Orden visual estable hasta resolver el empate manual.'
      )
  where participant_id is not null;$new$
    ]
  ];
  i integer;
begin
  select pg_get_functiondef(oid) into v_source
  from pg_proc
  where proname = 'rank_tournament_standings'
    and pronamespace = 'public'::regnamespace;

  if v_source is null then
    raise exception 'rank_tournament_standings not found';
  end if;

  v_patched := v_source;
  for i in 1 .. array_length(v_anchors, 1) loop
    if position(v_anchors[i][2] in v_patched) > 0 then
      continue; -- ya corregido: la migración es idempotente
    end if;
    if position(v_anchors[i][1] in v_patched) = 0 then
      raise exception
        'rank_tournament_standings anchor % not found; refusing to patch a definition we do not recognise', i;
    end if;
    v_patched := replace(v_patched, v_anchors[i][1], v_anchors[i][2]);
  end loop;

  if v_patched <> v_source then
    execute v_patched;
  end if;
end;
$rank_standings_safeupdate_guard$;

COMMENT ON FUNCTION "public"."rank_tournament_standings"("uuid") IS
  'Ordena la tabla de posiciones de una revisión. Todas las escrituras sobre la tabla temporal de trabajo llevan cláusula `where`, porque el rol `authenticator` de Supabase precarga `safeupdate` y rechazaría un `UPDATE` sin filtro: sin eso, recalcular la tabla desde la aplicación era imposible.';
