# Atomicidad de la segunda migración canónica

`20260727215106_canonical_core_rls_contracts.sql` se aplica mediante
`supabase db push`. En Supabase CLI 2.84.2 cada archivo y la escritura de su
versión en `supabase_migrations.schema_migrations` forman un único batch
implícitamente transaccional.

La migración canónica incorporaba nueve migraciones históricas de rollout de
forma literal, incluyendo sus `BEGIN` y `COMMIT`. Un `COMMIT` interno terminaba
anticipadamente la transacción del batch y permitía persistir un prefijo sin
registrar la versión si una sentencia posterior fallaba.

## Inventario retirado

Las líneas corresponden al archivo original en
`854f768ecae633ff460d9c37d9d261729a99525f`.

| Límites | Bloque histórico | Motivo histórico | Transacción única | Semántica al retirar |
| --- | --- | --- | --- | --- |
| 1129 / 1598 | `20260724121000_secure_no_show_ranking_stage_a.sql` | Agrupar helpers, RPC, policies y constraint de no-show. | Compatible. | Sin cambio en una ejecución exitosa. |
| 1668 / 2107 | `20260724122000_secure_notifications_stage_a.sql` | Agrupar normalización, RPC y policies de notificaciones. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2140 / 2225 | `20260724123000_secure_survey_progress_stage_a.sql` | Agrupar función/trigger y cierre RLS de `survey_progress`. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2269 / 2389 | `20260724124000_secure_jugadores_fotos_stage_a.sql` | Agrupar capability tokens, claims y policies de Storage. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2434 / 2564 | `20260724125000_harden_notification_rpc_content_stage_a.sql` | Reemplazar de forma conjunta el contenido server-side de dos RPCs. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2613 / 2773 | `20260726120000_drop_legacy_notifications_insert_policy_stage_a.sql` | Aplicar policies de compatibilidad y su gate como unidad. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2803 / 2818 | `20260724131000_revoke_direct_rating_writes_stage_b.sql` | Revocar como unidad las escrituras directas de ranking. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2854 / 2896 | `20260724132000_notifications_rpc_only_stage_b.sql` | Cerrar policies transitorias y ejecutar el gate Stage B. | Compatible. | Sin cambio en una ejecución exitosa. |
| 2924 / 2928 | `20260724134000_drop_anon_insert_jugadores_fotos_stage_b.sql` | Retirar la última policy de escritura anónima del bucket. | Compatible. | Sin cambio en una ejecución exitosa. |

No se encontraron `START TRANSACTION`, `ROLLBACK`, `SAVEPOINT`,
`SET TRANSACTION`, `CREATE INDEX CONCURRENTLY`,
`REFRESH MATERIALIZED VIEW CONCURRENTLY`, `VACUUM` ni meta-comandos de `psql`.
Los `BEGIN`/`END` dentro de cuerpos PL/pgSQL no son límites transaccionales y se
conservan.

## Certificación reproducible

```bash
npm run test:db:migration-atomicity
node scripts/db-integration/canonical-catalog-fingerprint.mjs
```

El test aplica sólo la baseline, inyecta una sentencia inválida cerca del final
de una copia temporal de la segunda migración y la ejecuta con
`supabase migration up`. Exige catálogo idéntico a la baseline y ausencia de la
segunda versión en el ledger. Después aplica el archivo real y exige dos
migraciones y el fingerprint final certificado.
