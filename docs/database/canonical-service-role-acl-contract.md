# Contrato `service_role` de auto-match

## Decisión

Las 22 firmas de esta allowlist conservan explícitamente el comportamiento
efectivo de PostgreSQL `17.6.1.095`:

- `service_role`: `EXECUTE` permitido;
- `PUBLIC`, `anon` y `authenticated`: `EXECUTE` denegado.

Estos permisos son acceso interno y no constituyen una API de cliente. La
migración revoca primero los cuatro roles y concede después únicamente a
`service_role`, por firma exacta y sin `GRANT OPTION`.

El default ACL de funciones creadas por el owner de migraciones `postgres`
bajo `public` queda cerrado. Por lo tanto, una función futura de la aplicación
no hereda acceso de `PUBLIC`, `anon`, `authenticated` ni `service_role`: debe
incorporarse expresamente a la allowlist que corresponda. No se modifica el
default ACL ambiental de `supabase_admin`, que el rol de migración no puede
administrar y del cual este contrato no depende.

## Procedencia reproducible

El inventario se obtuvo sobre `c5b67936cb3ae40234d92bde71cc19d0b5b9227c`
comparando el catálogo ordenado por:

```sql
namespace.nspname,
procedure_row.proname,
pg_get_function_identity_arguments(procedure_row.oid)
```

| CLI | Imagen PostgreSQL | Fingerprint previo |
| --- | --- | --- |
| `2.84.2` | `17.6.1.095` | `ff1cdbf9cdca35dd95bf67ab7652d9ebcd362e6bcadf0dabad13dcc21f495cf0` |
| `2.110.0` | `17.6.1.143` | `0f220cf907dfa7240a8c14fbd36248f395102b83e6b063f87e3f61e2acfc3394` |

Las 465 definiciones de función fueron idénticas. Las únicas 22 diferencias
efectivas fueron los grants de `service_role` enumerados abajo. En ambos
runtimes, `PUBLIC`, `anon` y `authenticated` ya estaban denegados para las 22.

## Inventario exacto

| Firma (`pg_get_function_identity_arguments`) | Seguridad | Lenguaje | Retorno | Trigger |
| --- | --- | --- | --- | --- |
| `public.auto_match_account_is_eligible(p_user_id uuid)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_availabilities_are_compatible(p_availability_a bigint, p_availability_b bigint)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_availability_fits_proposal(p_availability_id bigint, p_proposal_id bigint)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_availability_has_free_slot(p_availability_id bigint, p_proposal_id bigint)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_availability_is_eligible(p_availability_id bigint)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_distance_km(p_latitude_a double precision, p_longitude_a double precision, p_latitude_b double precision, p_longitude_b double precision)` | INVOKER | `sql` | `double precision` | no |
| `public.auto_match_duration(p_format text)` | INVOKER | `sql` | `interval` | no |
| `public.auto_match_has_valid_coordinates(p_latitude double precision, p_longitude double precision)` | INVOKER | `sql` | `boolean` | no |
| `public.auto_match_member_has_free_slot(p_proposal_id bigint, p_user_id uuid)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_member_snapshot_fits_proposal(p_proposal_id bigint, p_user_id uuid)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id bigint, p_user_id uuid)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_member_snapshots_are_compatible(p_proposal_id bigint, p_user_a uuid, p_user_b uuid)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_play_range(p_starts_at timestamp with time zone, p_format text)` | INVOKER | `sql` | `tstzrange` | no |
| `public.auto_match_snapshots_are_compatible(p_latitude_a double precision, p_longitude_a double precision, p_radius_a integer, p_latitude_b double precision, p_longitude_b double precision, p_radius_b integer)` | INVOKER | `sql` | `boolean` | no |
| `public.auto_match_user_real_match_conflict(p_user_id uuid, p_starts_at timestamp with time zone, p_format text, p_exclude_partido_id bigint)` | DEFINER | `sql` | `boolean` | no |
| `public.auto_match_window_has_free_slot(p_user_id uuid, p_proposed_starts_at timestamp with time zone, p_format text, p_days_of_week smallint[], p_time_start time without time zone, p_time_end time without time zone, p_timezone text, p_fixed_time boolean, p_exclude_partido_id bigint)` | DEFINER | `sql` | `boolean` | no |
| `public.capture_auto_match_member_snapshot()` | DEFINER | `plpgsql` | `trigger` | sí |
| `public.enforce_auto_match_member_eligibility()` | DEFINER | `plpgsql` | `trigger` | sí |
| `public.prevent_auto_match_member_snapshot_update()` | DEFINER | `plpgsql` | `trigger` | sí |
| `public.sync_active_auto_match_gestations()` | DEFINER | `plpgsql` | `TABLE(processed_count integer, failed_count integer)` | no |
| `public.user_declined_auto_match_slot(p_user_id uuid, p_format text, p_starts_at timestamp with time zone)` | DEFINER | `sql` | `boolean` | no |
| `public.user_has_overlapping_auto_match(p_user_id uuid, p_starts_at timestamp with time zone, p_exclude_proposal_id bigint)` | DEFINER | `sql` | `boolean` | no |

Para todas las filas, el estado previo fue:

| Runtime | `PUBLIC` | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- | --- |
| `.095` | denegado | denegado | denegado | permitido |
| `.143` | denegado | denegado | denegado | denegado |

## Referencias directas

No hay referencias directas desde Edge Functions ni desde comandos de
`cron.job` hacia ninguna de las 22 firmas. El job `auto_match_sweep` llama a
`public.auto_match_scheduled_sweep()`, que a su vez referencia
`public.sync_active_auto_match_gestations()`; esa relación es transitiva, no
directa.

Las referencias desde otras funciones se resolvieron contra las 22 identidades
exactas y se registran con firma completa:

| Firma allowlisted | Funciones que la referencian directamente |
| --- | --- |
| `public.auto_match_account_is_eligible(p_user_id uuid)` | `public.auto_match_availability_is_eligible(p_availability_id bigint)`; `public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id bigint, p_user_id uuid)`; `public.prune_ineligible_auto_match_members()`; `public.reconcile_auto_match_proposal_members(p_proposal_id bigint)`; `public.respond_to_auto_match_proposal(p_proposal_id bigint, p_response text, p_can_organize boolean)` |
| `public.auto_match_availabilities_are_compatible(p_availability_a bigint, p_availability_b bigint)` | `public.find_my_availability_matches(p_limit integer)`; `public.spawn_next_auto_match_cohort(p_proposal_id bigint)`; `public.sync_my_auto_match_gestations()` |
| `public.auto_match_availability_fits_proposal(p_availability_id bigint, p_proposal_id bigint)` | `public.backfill_auto_match_proposal_members(p_proposal_id bigint)`; `public.enforce_auto_match_member_eligibility()`; `public.sync_my_auto_match_gestations()` |
| `public.auto_match_availability_has_free_slot(p_availability_id bigint, p_proposal_id bigint)` | `public.auto_match_availability_fits_proposal(p_availability_id bigint, p_proposal_id bigint)` |
| `public.auto_match_availability_is_eligible(p_availability_id bigint)` | `public.auto_match_availabilities_are_compatible(p_availability_a bigint, p_availability_b bigint)`; `public.auto_match_availability_fits_proposal(p_availability_id bigint, p_proposal_id bigint)`; `public.backfill_auto_match_proposal_members(p_proposal_id bigint)`; `public.enforce_auto_match_member_eligibility()`; `public.find_my_availability_matches(p_limit integer)`; `public.spawn_next_auto_match_cohort(p_proposal_id bigint)`; `public.sync_active_auto_match_gestations()`; `public.sync_my_auto_match_gestations()`; `public.sync_my_auto_match_location_from_profile()`; `public.upsert_my_availability(p_days smallint[], p_time_start time without time zone, p_time_end time without time zone, p_formats text[], p_max_distance_km integer, p_latitude double precision, p_longitude double precision, p_can_organize boolean)` |
| `public.auto_match_distance_km(p_latitude_a double precision, p_longitude_a double precision, p_latitude_b double precision, p_longitude_b double precision)` | `public.auto_match_snapshots_are_compatible(p_latitude_a double precision, p_longitude_a double precision, p_radius_a integer, p_latitude_b double precision, p_longitude_b double precision, p_radius_b integer)`; `public.find_my_availability_matches(p_limit integer)`; `public.sync_my_auto_match_gestations()` |
| `public.auto_match_duration(p_format text)` | `public.auto_match_play_range(p_starts_at timestamp with time zone, p_format text)` |
| `public.auto_match_has_valid_coordinates(p_latitude double precision, p_longitude double precision)` | `public.auto_match_availability_is_eligible(p_availability_id bigint)`; `public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id bigint, p_user_id uuid)`; `public.auto_match_snapshots_are_compatible(p_latitude_a double precision, p_longitude_a double precision, p_radius_a integer, p_latitude_b double precision, p_longitude_b double precision, p_radius_b integer)`; `public.capture_auto_match_member_snapshot()`; `public.sync_my_auto_match_location_from_profile()`; `public.upsert_my_availability(p_days smallint[], p_time_start time without time zone, p_time_end time without time zone, p_formats text[], p_max_distance_km integer, p_latitude double precision, p_longitude double precision, p_can_organize boolean)` |
| `public.auto_match_member_has_free_slot(p_proposal_id bigint, p_user_id uuid)` | `public.enforce_auto_match_member_eligibility()`; `public.reconcile_auto_match_proposal_members(p_proposal_id bigint)`; `public.respond_to_auto_match_proposal(p_proposal_id bigint, p_response text, p_can_organize boolean)` |
| `public.auto_match_member_snapshot_fits_proposal(p_proposal_id bigint, p_user_id uuid)` | `public.enforce_auto_match_member_eligibility()` |
| `public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id bigint, p_user_id uuid)` | `public.auto_match_member_snapshot_fits_proposal(p_proposal_id bigint, p_user_id uuid)`; `public.enforce_auto_match_member_eligibility()`; `public.reconcile_auto_match_proposal_members(p_proposal_id bigint)`; `public.respond_to_auto_match_proposal(p_proposal_id bigint, p_response text, p_can_organize boolean)` |
| `public.auto_match_member_snapshots_are_compatible(p_proposal_id bigint, p_user_a uuid, p_user_b uuid)` | `public.enforce_auto_match_member_eligibility()`; `public.reconcile_auto_match_proposal_members(p_proposal_id bigint)`; `public.respond_to_auto_match_proposal(p_proposal_id bigint, p_response text, p_can_organize boolean)` |
| `public.auto_match_play_range(p_starts_at timestamp with time zone, p_format text)` | `public.auto_match_user_real_match_conflict(p_user_id uuid, p_starts_at timestamp with time zone, p_format text, p_exclude_partido_id bigint)`; `public.finalize_auto_match_proposal(p_proposal_id bigint, p_nombre text, p_fecha date, p_hora text, p_tipo_partido text, p_precio numeric, p_sede text, p_sede_place_id text, p_sede_direccion text, p_sede_latitud double precision, p_sede_longitud double precision)` |
| `public.auto_match_snapshots_are_compatible(p_latitude_a double precision, p_longitude_a double precision, p_radius_a integer, p_latitude_b double precision, p_longitude_b double precision, p_radius_b integer)` | `public.auto_match_availabilities_are_compatible(p_availability_a bigint, p_availability_b bigint)`; `public.auto_match_availability_fits_proposal(p_availability_id bigint, p_proposal_id bigint)`; `public.auto_match_member_snapshot_fits_proposal(p_proposal_id bigint, p_user_id uuid)`; `public.auto_match_member_snapshots_are_compatible(p_proposal_id bigint, p_user_a uuid, p_user_b uuid)` |
| `public.auto_match_user_real_match_conflict(p_user_id uuid, p_starts_at timestamp with time zone, p_format text, p_exclude_partido_id bigint)` | `public.auto_match_window_has_free_slot(p_user_id uuid, p_proposed_starts_at timestamp with time zone, p_format text, p_days_of_week smallint[], p_time_start time without time zone, p_time_end time without time zone, p_timezone text, p_fixed_time boolean, p_exclude_partido_id bigint)` |
| `public.auto_match_window_has_free_slot(p_user_id uuid, p_proposed_starts_at timestamp with time zone, p_format text, p_days_of_week smallint[], p_time_start time without time zone, p_time_end time without time zone, p_timezone text, p_fixed_time boolean, p_exclude_partido_id bigint)` | `public.auto_match_availability_has_free_slot(p_availability_id bigint, p_proposal_id bigint)`; `public.auto_match_member_has_free_slot(p_proposal_id bigint, p_user_id uuid)`; `public.spawn_next_auto_match_cohort(p_proposal_id bigint)`; `public.sync_my_auto_match_gestations()` |
| `public.capture_auto_match_member_snapshot()` | — |
| `public.enforce_auto_match_member_eligibility()` | — |
| `public.prevent_auto_match_member_snapshot_update()` | — |
| `public.sync_active_auto_match_gestations()` | `public.auto_match_scheduled_sweep()` |
| `public.user_declined_auto_match_slot(p_user_id uuid, p_format text, p_starts_at timestamp with time zone)` | `public.invite_auto_match_substitutes(p_proposal_id bigint, p_needed integer, p_allow_new boolean)` |
| `public.user_has_overlapping_auto_match(p_user_id uuid, p_starts_at timestamp with time zone, p_exclude_proposal_id bigint)` | `public.invite_auto_match_substitutes(p_proposal_id bigint, p_needed integer, p_allow_new boolean)` |

Las únicas referencias directas desde triggers son:

| Función trigger | Trigger |
| --- | --- |
| `public.capture_auto_match_member_snapshot()` | `public.auto_match_proposal_members.auto_match_member_snapshot_capture_trigger` |
| `public.enforce_auto_match_member_eligibility()` | `public.auto_match_proposal_members.enforce_auto_match_member_eligibility_trigger` |
| `public.prevent_auto_match_member_snapshot_update()` | `public.auto_match_proposal_members.auto_match_member_snapshot_immutable_trigger` |

## Certificación entre runtimes

Después de aplicar la allowlist explícita:

| Comprobación | `.095` | `.143` |
| --- | --- | --- |
| Fingerprint global | `ff1cdbf9cdca35dd95bf67ab7652d9ebcd362e6bcadf0dabad13dcc21f495cf0` | `ff1cdbf9cdca35dd95bf67ab7652d9ebcd362e6bcadf0dabad13dcc21f495cf0` |
| Hash `functions` | `6bafb4059ed0897909ade0aafa4bdbb2cd6518e64e9d6e1d359965329d77d436` | `6bafb4059ed0897909ade0aafa4bdbb2cd6518e64e9d6e1d359965329d77d436` |
| Hash `function_grants` | `3807bdc5fc4aa0cdca7157411585a505251e6d56d78872849f76c3fa10da9869` | `3807bdc5fc4aa0cdca7157411585a505251e6d56d78872849f76c3fa10da9869` |
| Grants expandidos | `1162` | `1162` |
| Diferencias de privilegios por firma | `0` | `0` |
| Reconstrucciones determinísticas | `5/5` | `5/5` |

Los conteos efectivos en ambos entornos quedaron en `PUBLIC=0`, `anon=18`,
`authenticated=222` y `service_role=457`.
