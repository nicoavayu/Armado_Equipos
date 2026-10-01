# SEASON-SCOPE-FIX — `get_effective_tournament_season_entitlements` ata organización y temporada

Estado: **TORNEOS_SEASON_SCOPE_FIX_READY (lab)**. Sólo local: no se tocó Production DB, Cloud Run, Vercel, Deno, Android
ni Billing/MP. No hay push ni PR.

## Causa raíz (reproducida, no supuesta)

Cuerpo certificado POST_0006 (md5 `a533331a…`, idéntico al baseline `00000000000000`, línea ~7879):

1. Autoriza **sólo** con `public.has_tournament_season_access(p_organization_id, p_season_id)`.
2. Esa helper tiene dos ramas. La de **owner** (`membership.role = 'owner'`) no mira `p_season_id` en absoluto:
   el owner de la organización A pasa para **cualquier** id de temporada (de B, inexistente o NULL).
   La rama de colaborador/admin sí liga el par, porque pasa por `tournament_season_member_assignments`, cuya FK
   compuesta `(organization_id, season_id) → tournament_seasons(organization_id, id)` lo garantiza.
3. Después llama a `resolve_effective_tournament_season_entitlements_at`, que **sí** liga el par y devuelve `NULL` si
   la temporada no es de la organización. La RPC no comprueba ese `NULL`: `jsonb_set(NULL, …)` es `NULL` y lo devuelve.
4. PostgREST responde un escalar `NULL` como **HTTP 200 con cuerpo `null`**; el gateway lo reenvía tal cual (proxy
   genérico con la RPC en el allowlist). De ahí el 200 en los dos casos cruzados.

La RPC por torneo no tiene el problema: obtiene `season_id` de `tournaments WHERE organization_id = p_org AND id = p_tournament`
y rechaza si es `NULL` antes de mirar membership.

Consecuencias:

- No se filtraron datos de otra organización: el cuerpo es `null`. Lo que falla es el contrato de autorización
  (200 en vez de 403), y la UI podría leer ese `null` como si hubiera una respuesta válida.
- Para que «temporada QA + otra organización» diera 200 en el shadow, la identidad QA tiene que ser **owner** también
  de esa otra organización. Si no es miembro, el lab da 403 (caso N8). Conviene confirmarlo con la evidencia del shadow.

## Fix (mínimo, sólo SQL)

Migration nueva `supabase/migrations/00000000000007_season_entitlements_scope.sql` (sha256 `ba0450f9…`). Reemplaza
**sólo** el cuerpo de la RPC de temporada:

```sql
if p_organization_id is null or p_season_id is null or not exists (
  select 1 from public.tournament_seasons season
  where season.organization_id=p_organization_id and season.id=p_season_id
) or not public.has_tournament_season_access(p_organization_id,p_season_id) then
  raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
end if;
…resolve…
if v_result is null then   -- fail closed: nunca 200 null
  raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
end if;
```

- Firma, tipo de retorno, `STABLE`, `SECURITY DEFINER`, `search_path=''`, owner y ACL no cambian. `CREATE OR REPLACE` los
  conserva y la postcondición lo comprueba.
- Las precondiciones/postcondiciones fijan el md5 del cuerpo: sólo acepta POST_0006 (`a533331a…`) o el propio
  (`bf263aca…`). Re-aplicarla no hace nada y un cuerpo desconocido se rechaza. EXECUTE sigue siendo sólo para
  `authenticated` (y `service_role`), nunca para `anon`.
- El rechazo usa el mismo código y mensaje que el caso de torneo que ya pasaba: 42501 → **403
  TORNEOS_ENTITLEMENTS_FORBIDDEN**. Los rechazos por par inexistente y por falta de membership son indistinguibles,
  así que no se puede usar la respuesta para descubrir si una temporada existe.
- No se modificaron migrations históricas ni `has_tournament_season_access`, el resolver, la RPC por torneo, el gateway
  o el frontend.
- Rollback: `rollback/00000000000007_season_entitlements_scope.rollback.sql` (sha256 `05498599…`). Restaura byte a byte
  el cuerpo POST_0006 y tiene las mismas guardas. Sólo debe usarse con PLAN READ y Commerce en OFF.

## Certificación local (`lab/run-lab.sh`, desechable, `SEASON_SCOPE_FIX_LAB_PASS`)

Postgres `supabase/postgres:17.6.1.143` y PostgREST `v14.15` propios en una red docker privada, con secretos aleatorios
en mktemp. Se aplica 0000…0006, luego el fixture (U owner de A y B, V sin membership, W colaborador de A asignado sólo
a la temporada A) y la secuencia RED → 0007 → GREEN → re-apply → rollback → RED → 0007 → GREEN. Al terminar se destruye todo.

| Matriz | POST_0006 | POST_0007 |
|---|---|---|
| SQL como `authenticated` con claims del bridge (19 casos) | 14 PASS / **5 FAIL** (todos owner → `NULL`) | **19/19** |
| HTTP vía PostgREST real (10 casos) | 7 PASS / **3 FAIL** (200 `null`) | **10/10** |

- Los dos casos que fallaban (N1 org A + temporada B; N2 org B + temporada A): **200 null → 403**.
- También rechaza: temporada inexistente, org inexistente, temporada/org NULL, temporada de una org ajena, usuario sin
  membership, colaborador con temporada no asignada o de otra org, sin claims → `TORNEOS_AUTH_REQUIRED`, sin bearer → 401
  y firma inválida → 401.
- Positivos: owner en sus dos temporadas, owner de B, colaborador asignado y RPC por torneo → 200 FREE /
  `default_free`, galería 25, colaboradores admin 1, Social 3 y hash de capabilities **idénticos** antes y después.
- La RPC por torneo queda igual: 200 en el par válido, 403 para org B + torneo A y para torneo NULL; md5 `829ed78a…` sin
  cambios.
- Catálogo: entre POST_0006 y POST_0007 **sólo** cambia el md5 del cuerpo de la RPC de temporada
  (`evidence/catalog-diff.txt`). La helper, el resolver y la RPC por torneo quedan byte-idénticos. Después del rollback,
  el catálogo vuelve a ser idéntico a POST_0006.
- 0001…0007 se pueden re-aplicar en orden (semántica de `lab.mjs`).

## Gateway / G1 / Commerce

El gateway no cambió. `npm run test:torneos:g1` dio 9/10: pasan la matriz G1 de 72 casos (health × Core-session ×
identity, incluido Core caído → fail closed), precedencia, bearer, identity, timeouts, solapamiento de los 3 checks y
`/exchange`. El único fallo es el pin de confinamiento de archivos («repository changes are confined…»), que ya fallaba
en `main@4a8c5bbe` por la deriva de main: el primer archivo que marca es `android/app/build.gradle`, del merge del
build 44. `commerce-gateway` unit da 31/33 por el mismo motivo (pin de scope MP-A4 contra su base histórica, más de 820
archivos de deriva de main). Commerce, Billing y MP LIVE siguen OFF. Las 14 rutas comerciales que dieron 403 en el
shadow no dependen de esta RPC.

## Lo que queda fuera / riesgos

- **Shadow**: `tgw-sp-g1` reutiliza los secretos de Production, así que apunta a la **DB Torneos de Production**. El fix
  es sólo DB: redeployar el shadow no cambia nada. Para repetir N1 y N2 en el shadow hace falta (1) aplicar 0007 en la
  DB de Production, con go explícito, y (2) **un `/exchange`** nuevo, porque el bearer anterior ya venció. No se hizo
  ninguna de las dos cosas.
- **Integración con `codex/torneos-plan-ux-local`**: esta rama sale de `main@4a8c5bbe`. No pude fast-forwardear ni leer
  esa rama, porque la acción fue denegada en esta sesión. El cambio no toca gateway ni frontend, así que debería
  aplicarse sin conflictos, pero si esa rama extiende el pin de confinamiento G1 hay que sumar estos archivos a su delta.
- **Numeración**: hay un `0007` de perf-v2 propuesto **fuera** de `migrations/` (`backend/torneos/perf-v2/proposed/`).
  Si se promueve, va después de este.
- **Seguimiento (no se arregló acá)**: la rama owner de `has_tournament_season_access` sigue sin ligar el par. Otros
  llamadores (0004–0006) derivan `season_id` con subselects filtrados por organización: si el objeto no es de la org, el
  `season_id` queda `NULL` y la helper devuelve `true` para un owner. Esos llamadores suelen exigir además que el objeto
  exista en la org, pero vale la pena hacer un barrido y, si corresponde, endurecer la helper. Eso cambia RLS y
  rendimiento, así que va en una tarea aparte.
