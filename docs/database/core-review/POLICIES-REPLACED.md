# Policies reemplazadas en Core Producción (stack 20261010119000…143000)

Alcance autorizado por Nico (2026-10-09): **preparar y ensayar** el reemplazo de sólo estas policies.
**Nada de esto está aplicado en Producción.** Aplicarlo es D3 y necesita un GO nuevo después del ensayo.

Alcance:

- `partidos` / `jugadores`: sus policies `SELECT` e `INSERT` abiertas;
- los campos privados de `usuarios` (135000): se resuelve sacando los valores de la fila, **sin tocar policies de `usuarios`**;
- las tablas de votación de invitados `public_voters` / `votos_publicos`: su lectura e inserción abiertas.

Quedan **intactas** (verificado, ver §4):

- las policies `UPDATE`/`DELETE` de Producción en `partidos`/`jugadores`;
- `partidos_insert_own`;
- `deny_all` y los `DELETE` del organizador en las tablas de votación;
- todas las policies de `profiles`, `amigos`, `notifications`, `post_match_surveys`, `partidos_frecuentes` y `usuarios`;
- todas las del resto del esquema `public`.

Fuente: `pg_policies` del esquema **real** de Producción (`pg_dump --schema-only` del 2026-10-09,
`~/Arma2Backups/d3-core-schema-20261009-1641.sql`), cargado en un contenedor descartable sin red,
antes (R0) y después de aplicar las 25 migraciones. Las definiciones son las que imprime Postgres
(`qual` / `with_check`), con los saltos de línea colapsados.

## 1. Policies que se quitan (18), su reemplazo y su rollback

"Rollback" es la sentencia exacta que vuelve a crear la original. La ejecuta
`runbook/rollbacks/20261010119000_core_production_alignment.rollback.sql` a partir de
`app_private.production_alignment_log`, donde 119000 guarda cada policy antes de borrarla
(nombre, `permissive`, roles, `cmd`, `using`, `check`).

| # | Tabla | Policy original (Producción) | Cmd | Roles | Definición original | Reemplazo | Rollback |
|---|---|---|---|---|---|---|---|
| 1 | `partidos` | `Authenticated can insert matches` | INSERT | public | WITH CHECK `(auth.uid() IS NOT NULL)` | `partidos_insert_own` de Producción (se mantiene, `creado_por = auth.uid()`) | `create policy "Authenticated can insert matches" on public.partidos as PERMISSIVE for INSERT to public with check ((auth.uid() IS NOT NULL));` |
| 2 | `partidos` | `Creators can view their own matches` | SELECT | public | USING `(auth.uid() = creado_por)` | `partidos_select_authenticated` (cuentas: lo propio y los partidos donde participa) + `partidos_select_public_reader` (sólo el rol dueño de las vistas, para los partidos abiertos publicados). anon: ninguna lectura directa; el link usa `public_get_match_by_code(código, id)` | `create policy "Creators can view their own matches" on public.partidos as PERMISSIVE for SELECT to public using ((auth.uid() = creado_por));` |
| 3 | `partidos` | `Lectura publica partidos` | SELECT | public | USING `true` | `partidos_select_authenticated` (cuentas: lo propio y los partidos donde participa) + `partidos_select_public_reader` (sólo el rol dueño de las vistas, para los partidos abiertos publicados). anon: ninguna lectura directa; el link usa `public_get_match_by_code(código, id)` | `create policy "Lectura publica partidos" on public.partidos as PERMISSIVE for SELECT to public using (true);` |
| 4 | `partidos` | `Players can view matches they are in` | SELECT | public | USING `(EXISTS ( SELECT 1 FROM jugadores j WHERE ((j.partido_id = partidos.id) AND (j.usuario_id = auth.uid()))))` | `partidos_select_authenticated` (cuentas: lo propio y los partidos donde participa) + `partidos_select_public_reader` (sólo el rol dueño de las vistas, para los partidos abiertos publicados). anon: ninguna lectura directa; el link usa `public_get_match_by_code(código, id)` | `create policy "Players can view matches they are in" on public.partidos as PERMISSIVE for SELECT to public using ((EXISTS ( SELECT 1 FROM jugadores j WHERE ((j.partido_id = partidos.id) AND (j.usuario_id = auth.uid())))));` |
| 5 | `partidos` | `Public can see active matches` | SELECT | authenticated | USING `true` | `partidos_select_authenticated` (cuentas: lo propio y los partidos donde participa) + `partidos_select_public_reader` (sólo el rol dueño de las vistas, para los partidos abiertos publicados). anon: ninguna lectura directa; el link usa `public_get_match_by_code(código, id)` | `create policy "Public can see active matches" on public.partidos as PERMISSIVE for SELECT to authenticated using (true);` |
| 6 | `partidos` | `partidos_select_if_creator_or_player` | SELECT | public | USING `((creado_por = auth.uid()) OR (EXISTS ( SELECT 1 FROM jugadores j WHERE ((j.match_ref = partidos.match_ref) AND (j.usuario_id = auth.uid())))))` | `partidos_select_authenticated` (cuentas: lo propio y los partidos donde participa) + `partidos_select_public_reader` (sólo el rol dueño de las vistas, para los partidos abiertos publicados). anon: ninguna lectura directa; el link usa `public_get_match_by_code(código, id)` | `create policy partidos_select_if_creator_or_player on public.partidos as PERMISSIVE for SELECT to public using (((creado_por = auth.uid()) OR (EXISTS ( SELECT 1 FROM jugadores j WHERE ((j.match_ref = partidos.match_ref) AND (j.usuario_id = auth.uid()))))));` |
| 7 | `partidos` | `partidos_select_open_for_authenticated` | SELECT | authenticated | USING `(estado = 'abierto'::text)` | `partidos_select_authenticated` (cuentas: lo propio y los partidos donde participa) + `partidos_select_public_reader` (sólo el rol dueño de las vistas, para los partidos abiertos publicados). anon: ninguna lectura directa; el link usa `public_get_match_by_code(código, id)` | `create policy partidos_select_open_for_authenticated on public.partidos as PERMISSIVE for SELECT to authenticated using ((estado = 'abierto'::text));` |
| 8 | `jugadores` | `Authenticated can insert jugadores` | INSERT | public | WITH CHECK `(auth.role() = 'authenticated'::text)` | `jugadores_insert_self_or_admin` (el organizador, o la propia cuenta con invitación, solicitud aprobada o link validado) | `create policy "Authenticated can insert jugadores" on public.jugadores as PERMISSIVE for INSERT to public with check ((auth.role() = 'authenticated'::text));` |
| 9 | `jugadores` | `jugadores_insert_creator` | INSERT | authenticated | WITH CHECK `(usuario_id = auth.uid())` | `jugadores_insert_self_or_admin` (el organizador, o la propia cuenta con invitación, solicitud aprobada o link validado) | `create policy jugadores_insert_creator on public.jugadores as PERMISSIVE for INSERT to authenticated with check ((usuario_id = auth.uid()));` |
| 10 | `jugadores` | `Lectura publica jugadores` | SELECT | public | USING `true` | `jugadores_select_authenticated` (organizador y plantel del partido, más las filas propias; pedir sumarse o recibir un aviso no alcanza) + `jugadores_select_public_reader` (rol dueño de las vistas). Afuera y anon: sólo entradas enmascaradas (sin `usuario_id`, `score` ni `responsabilidad_score`; `uuid` opaco) | `create policy "Lectura publica jugadores" on public.jugadores as PERMISSIVE for SELECT to public using (true);` |
| 11 | `jugadores` | `Players can see others in same match` | SELECT | authenticated | USING `true` | `jugadores_select_authenticated` (organizador y plantel del partido, más las filas propias; pedir sumarse o recibir un aviso no alcanza) + `jugadores_select_public_reader` (rol dueño de las vistas). Afuera y anon: sólo entradas enmascaradas (sin `usuario_id`, `score` ni `responsabilidad_score`; `uuid` opaco) | `create policy "Players can see others in same match" on public.jugadores as PERMISSIVE for SELECT to authenticated using (true);` |
| 12 | `jugadores` | `Public can read joueurs debug` | SELECT | public | USING `true` | `jugadores_select_authenticated` (organizador y plantel del partido, más las filas propias; pedir sumarse o recibir un aviso no alcanza) + `jugadores_select_public_reader` (rol dueño de las vistas). Afuera y anon: sólo entradas enmascaradas (sin `usuario_id`, `score` ni `responsabilidad_score`; `uuid` opaco) | `create policy "Public can read joueurs debug" on public.jugadores as PERMISSIVE for SELECT to public using (true);` |
| 13 | `jugadores` | `Public can read jugadores` | SELECT | public | USING `true` | `jugadores_select_authenticated` (organizador y plantel del partido, más las filas propias; pedir sumarse o recibir un aviso no alcanza) + `jugadores_select_public_reader` (rol dueño de las vistas). Afuera y anon: sólo entradas enmascaradas (sin `usuario_id`, `score` ni `responsabilidad_score`; `uuid` opaco) | `create policy "Public can read jugadores" on public.jugadores as PERMISSIVE for SELECT to public using (true);` |
| 14 | `jugadores` | `Universal read players` | SELECT | public | USING `true` | `jugadores_select_authenticated` (organizador y plantel del partido, más las filas propias; pedir sumarse o recibir un aviso no alcanza) + `jugadores_select_public_reader` (rol dueño de las vistas). Afuera y anon: sólo entradas enmascaradas (sin `usuario_id`, `score` ni `responsabilidad_score`; `uuid` opaco) | `create policy "Universal read players" on public.jugadores as PERMISSIVE for SELECT to public using (true);` |
| 15 | `public_voters` | `Public voters can be created by everyone` | INSERT | public | WITH CHECK `true` | ninguna: sólo escriben las RPC de votación (SECURITY DEFINER), que validan código + partido | `create policy "Public voters can be created by everyone" on public.public_voters as PERMISSIVE for INSERT to public with check (true);` |
| 16 | `public_voters` | `Public voters are visible to everyone` | SELECT | public | USING `true` | `public_voters_select_match_member` (plantel y organizador del partido) | `create policy "Public voters are visible to everyone" on public.public_voters as PERMISSIVE for SELECT to public using (true);` |
| 17 | `votos_publicos` | `Public votes can be created by everyone` | INSERT | public | WITH CHECK `true` | ninguna: sólo escriben las RPC de votación (SECURITY DEFINER), que validan código + partido | `create policy "Public votes can be created by everyone" on public.votos_publicos as PERMISSIVE for INSERT to public with check (true);` |
| 18 | `votos_publicos` | `Public votes are visible to everyone` | SELECT | public | USING `true` | `votos_publicos_select_match_member` (plantel y organizador del partido) | `create policy "Public votes are visible to everyone" on public.votos_publicos as PERMISSIVE for SELECT to public using (true);` |

## 2. Policies nuevas (7), en su forma final después de 143000

| Tabla | Policy | Cmd | Roles | Definición final | La fijan | Cómo se deshace |
|---|---|---|---|---|---|---|
| `partidos` | `partidos_select_authenticated` | SELECT | authenticated | USING `((COALESCE(creado_por, admin_id) = ( SELECT auth.uid() AS uid)) OR ((deleted_at IS NULL) AND ((admin_id = ( SELECT auth.uid() AS uid)) OR app_private.match_involves_user(id))))` | 119000 (crea), 136000 y 137000 (ajustan) | rollback 137000 y 136000 la devuelven a la de 119000; rollback 119000 la borra |
| `partidos` | `partidos_select_public_reader` | SELECT | core_match_public_reader | USING `((( SELECT app_private.request_user_id() AS request_user_id) IS NOT NULL) AND ((COALESCE(creado_por, admin_id) = ( SELECT app_private.request_user_id() AS request_user_id)) OR ((deleted_at IS NULL) AND ((admin_id = ( SELECT app_private.request_user_id() AS request_user_id)) OR partido_is_operationally_open(estado, deleted_at, survey_status, result_status, finished_at, fecha, hora, (COALESCE(falta_jugadores, false) OR COALESCE(busca_arquero, false)), now()) OR app_private.match_involves_user(id, ( SELECT app_private.request_user_id() AS request_user_id))))))` | 137000 | rollback 137000 la borra |
| `jugadores` | `jugadores_insert_self_or_admin` | INSERT | authenticated | WITH CHECK `(app_private.is_match_admin(partido_id) OR ((usuario_id = ( SELECT auth.uid() AS uid)) AND ((partido_id IS NULL) OR app_private.may_self_join_match(partido_id))))` | 119000 (crea), 140000 (ajusta) | rollback 140000 la devuelve a la de 119000; rollback 119000 la borra |
| `jugadores` | `jugadores_select_authenticated` | SELECT | authenticated | USING `((usuario_id = ( SELECT auth.uid() AS uid)) OR ((partido_id IS NULL) AND (match_ref IS NULL)) OR ((partido_id IS NULL) AND app_private.match_ref_roster_identity_visible(match_ref)) OR app_private.match_roster_identity_visible(partido_id))` | 119000 (crea), 136000, 140000 y 143000 (ajustan) | rollbacks 143000, 140000 y 136000 la devuelven a la de 119000; rollback 119000 la borra |
| `jugadores` | `jugadores_select_public_reader` | SELECT | core_match_public_reader | USING `((( SELECT app_private.request_user_id() AS request_user_id) IS NOT NULL) AND ((partido_id IS NULL) OR (usuario_id = ( SELECT app_private.request_user_id() AS request_user_id)) OR app_private.match_involves_user(partido_id, ( SELECT app_private.request_user_id() AS request_user_id)) OR app_private.match_is_publicly_open(partido_id)))` | 137000 | rollback 137000 la borra |
| `public_voters` | `public_voters_select_match_member` | SELECT | authenticated | USING `(app_private.is_match_player(partido_id) OR app_private.is_match_admin(partido_id))` | 119000 | rollback 119000 la borra |
| `votos_publicos` | `votos_publicos_select_match_member` | SELECT | authenticated | USING `(app_private.is_match_player(partido_id) OR app_private.is_match_admin(partido_id))` | 119000 | rollback 119000 la borra |

`core_match_public_reader` es el rol sin login dueño de `partidos_view` y de las vistas de
partidos abiertos (137000). Las vistas corren como ese rol: las policies `*_public_reader` son lo
único que ven, y `app_private.roster_entry_json` (140000) les quita `usuario_id`/`score` a quien
no participa del partido.

## 3. Rollback exacto

Orden (RUNBOOK-193 §9), cada archivo con `psql -1 -v ON_ERROR_STOP=1`:

1. rollbacks 143000 → 133000. 143000, 140000, 137000 y 136000 devuelven las policies de §2 a la forma
   que les dio 119000 y 137000 borra las `*_public_reader`;
2. 132000 → 120000 ([PROMOTION.md §5](PROMOTION.md)): no tocan ninguna de estas policies;
3. `20261010119000_core_production_alignment.rollback.sql`, **último**:
   - borra las que creó: `drop policy if exists <nombre> on public.<tabla>`, para
     `partidos_select_authenticated`, `jugadores_select_authenticated`,
     `jugadores_insert_self_or_admin`, `public_voters_select_match_member` y
     `votos_publicos_select_match_member`;
   - vuelve a crear las 18 originales con las sentencias de la columna "Rollback" de §1.

Las sentencias de §1, para correrlas a mano sin el log, en una transacción y después de los
pasos 1 y 2:

```sql
begin;
drop policy if exists partidos_select_authenticated on public.partidos;
drop policy if exists jugadores_select_authenticated on public.jugadores;
drop policy if exists jugadores_insert_self_or_admin on public.jugadores;
drop policy if exists public_voters_select_match_member on public.public_voters;
drop policy if exists votos_publicos_select_match_member on public.votos_publicos;
create policy "Authenticated can insert matches" on public.partidos as PERMISSIVE for INSERT to public with check ((auth.uid() IS NOT NULL));
create policy "Creators can view their own matches" on public.partidos as PERMISSIVE for SELECT to public using ((auth.uid() = creado_por));
create policy "Lectura publica partidos" on public.partidos as PERMISSIVE for SELECT to public using (true);
create policy "Players can view matches they are in" on public.partidos as PERMISSIVE for SELECT to public using ((EXISTS ( SELECT 1 FROM jugadores j WHERE ((j.partido_id = partidos.id) AND (j.usuario_id = auth.uid())))));
create policy "Public can see active matches" on public.partidos as PERMISSIVE for SELECT to authenticated using (true);
create policy partidos_select_if_creator_or_player on public.partidos as PERMISSIVE for SELECT to public using (((creado_por = auth.uid()) OR (EXISTS ( SELECT 1 FROM jugadores j WHERE ((j.match_ref = partidos.match_ref) AND (j.usuario_id = auth.uid()))))));
create policy partidos_select_open_for_authenticated on public.partidos as PERMISSIVE for SELECT to authenticated using ((estado = 'abierto'::text));
create policy "Authenticated can insert jugadores" on public.jugadores as PERMISSIVE for INSERT to public with check ((auth.role() = 'authenticated'::text));
create policy jugadores_insert_creator on public.jugadores as PERMISSIVE for INSERT to authenticated with check ((usuario_id = auth.uid()));
create policy "Lectura publica jugadores" on public.jugadores as PERMISSIVE for SELECT to public using (true);
create policy "Players can see others in same match" on public.jugadores as PERMISSIVE for SELECT to authenticated using (true);
create policy "Public can read joueurs debug" on public.jugadores as PERMISSIVE for SELECT to public using (true);
create policy "Public can read jugadores" on public.jugadores as PERMISSIVE for SELECT to public using (true);
create policy "Universal read players" on public.jugadores as PERMISSIVE for SELECT to public using (true);
create policy "Public voters can be created by everyone" on public.public_voters as PERMISSIVE for INSERT to public with check (true);
create policy "Public voters are visible to everyone" on public.public_voters as PERMISSIVE for SELECT to public using (true);
create policy "Public votes can be created by everyone" on public.votos_publicos as PERMISSIVE for INSERT to public with check (true);
create policy "Public votes are visible to everyone" on public.votos_publicos as PERMISSIVE for SELECT to public using (true);
commit;
```

## 4. Verificación (ensayo del 2026-10-09 sobre el esquema real)

- **Policies que se quitan:** las 18 de §1, y ninguna otra. El precheck las lista
  (`policies_to_replace`); si en Producción la lista no es exactamente esta, parar.
- **Policies intactas:** 192 policies del esquema `public` quedan fuera del alcance, entre ellas
  `UPDATE`/`DELETE` de `partidos`/`jugadores`, `partidos_insert_own`, `deny_all` y los `DELETE`
  de votación. Su digest (`md5` de nombre, `permissive`, `cmd`, roles, `using` y `check`) es
  `86fa2f8a1ac188f4bfdeff38e700364e` antes y después de las 25 migraciones:
  - 119000 lo guarda en `production_alignment_log` (`untouched_policies_digest`);
  - el post-check falla si cambió.
- **Rollback de policies:** después de las 25 migraciones, los rollbacks 143000→133000 y luego
  119000 dejan las 60 policies de `partidos`, `jugadores`, `public_voters`, `votos_publicos`,
  `usuarios`, `profiles`, `amigos`, `notifications`, `post_match_surveys`, `partidos_frecuentes`
  y `match_join_requests` idénticas a R0, campo por campo.
  Con las sentencias de §3 corridas a mano en lugar del archivo de rollback, el resultado también
  es idéntico.
- **119000 sola:** aplicarla y deshacerla deja el catálogo con el mismo digest que R0 (pasada C).
- **Ensayos A/B:** las 25 migraciones y sus rollbacks pasan sobre el esquema real; ver RUNBOOK-193 §11 y
  `runbook/evidence/rehearsal-prod-schema-20261009.json`.

Se mantienen, en estas cuatro tablas:

| Tabla | Policy | Cmd |
|---|---|---|
| `partidos` | `partidos_delete_own` | DELETE |
| `partidos` | `partidos_insert_own` | INSERT |
| `partidos` | `Admins can update their matches` | UPDATE |
| `partidos` | `partidos_update_own` | UPDATE |
| `jugadores` | `jugadores_delete_admin_only` | DELETE |
| `jugadores` | `jugadores_delete_own` | DELETE |
| `jugadores` | `jugadores_update_admin_only` | UPDATE |
| `public_voters` | `deny_all` | ALL |
| `public_voters` | `Admins can delete public voters` | DELETE |
| `votos_publicos` | `deny_all` | ALL |
| `votos_publicos` | `Admins can delete public votes` | DELETE |

## 5. Votación por link de WhatsApp

Sigue sin login y con identificación por nombre. El link sólo da acceso a **su** partido.

Cómo funciona:

- anon no lee ni escribe `partidos`, `jugadores`, `public_voters` ni `votos_publicos` directamente;
- el link llama `public_get_match_by_code(código, id)`, que devuelve el partido y su plantel
  (sin `usuario_id`) sólo si el código es el de ese partido;
- los votos entran por las RPC SECURITY DEFINER (`public_submit_player_rating`,
  `public_submit_no_lo_conozco`, `public_mark_voter_completed`), que validan código + partido;
- `public_get_or_create_voter` queda sólo para esas RPC (121000; su ACL previo se guarda y el
  rollback lo restaura).

Smoke sobre el esquema real (`integration/prod-schema/smoke.sql`, 55/55):

- "anon: no rows from partidos/jugadores/view";
- "anon: the code opens its match, entries without usuario_id";
- "143 anon: link entries carry no account id or responsabilidad_score";
- "anon: a code opens only its own match";
- "anon: guest votes by name";
- "anon: a registered name cannot vote as guest";
- "anon: a code does not vote on another match";
- "anon: voters/votes tables not readable";
- "anon: cannot write voters/votes directly";
- "121 anon: cannot call public_get_or_create_voter".

La compatibilidad con 1.1.21 sobre el esquema real la verifica el coordinador en el gate B.
