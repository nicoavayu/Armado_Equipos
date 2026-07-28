# Migraciones canónicas

Esta carpeta es la única ruta activa para Supabase CLI.

- `20260727090000_arma2_canonical_baseline.sql` reproduce el estado funcional
  completo de Arma2 personal y Arma2 Torneos sin datos productivos.
- `20260727215106_canonical_core_rls_contracts.sql` restaura contratos
  pre-versionados que `pg_dump --schema=public` no puede capturar (por ejemplo,
  triggers sobre `auth.users`) y explicita RLS/RPCs de compatibilidad.

El historial anterior se conserva sin modificaciones en
`supabase/migrations_history/`. No debe copiarse nuevamente a esta carpeta:
contiene migraciones incrementales que presuponen estado remoto previo.

Comandos de verificación:

```bash
npx supabase db reset --local --no-seed
npm run db:contract
npm run test:db:golden
npm run test:db:torneos
```
