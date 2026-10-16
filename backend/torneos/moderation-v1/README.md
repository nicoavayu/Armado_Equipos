# MODERATION 0022 — reportar contenido, moderación y bloqueo

Diseño: `docs/superpowers/specs/2026-10-15-torneos-moderation-design.md`.
Migración: `backend/torneos/supabase/migrations/00000000000022_content_moderation.sql`.
Rollback: `rollback/00000000000022_content_moderation.rollback.sql`.
Driver del operador: `remote/db-0022.mjs`.

**Estado: preparado y ensayado sólo en un laboratorio local con datos ficticios. No se aplicó a Production ni a
Staging. No se desplegó nada.**

## Qué hay

| Pieza | Dónde |
|---|---|
| 5 tablas (RLS, sin grants de API), 7 RPC para `authenticated`, 2 funciones `platform_*` sin grant de API, 3 triggers nuevos | migración 0022 |
| Allowlist del gateway: grupos `content_reports`, `content_moderation`, `user_blocks` dentro de CONNECTED-V1 | `torneos-gateway/connected-v1-rpc-allowlist.json`, `connected-v1/contract.json` (`moderation`) |
| Cliente híbrido y LOCAL, mismos cuerpos `p_*` | `src/features/torneos/domain/contentModeration.js`, `stagingV1WorkspaceService.js`, `api/tournamentWorkspaceService.js`, `stagingV1/contentReportService.js` |
| UI | `components/moderation/*`, página pública, comunicados, bandeja de solicitudes, Configuración → Moderación |
| Términos | `src/pages/TermsPage.js` («Contenido prohibido y moderación») |

## Pruebas

```
npm run test:torneos:moderation          # driver offline + laboratorio (Docker)
npm run test:torneos:connected           # gateway CONNECTED-V1 con las RPC nuevas
npm run test:torneos:frontend-foundation # alcance del cliente, adaptadores, B04
```

El laboratorio es el PostgreSQL descartable de `commerce-production/lab/pg-lab.mjs` (contenedor propio por checkout).
En un host con los pools de Docker agotados, crear antes la red del laboratorio con subred explícita:
`docker network create --subnet 10.233.60.0/24 arma2-moderation-lab-db-<tag>-net` (pg-lab reutiliza una red existente).

## Despliegue (cada paso con su GO, en este orden)

1. **Base de datos**: `node backend/torneos/moderation-v1/remote/db-0022.mjs observe` → debe decir `PRE_0022`.
   Después `apply-0022 APPLY TORNEOS 0022 <ref> <sha12>` (la frase exacta la imprime el driver si falta).
   Verifica antes y después: cuerpos (md5), ACL, tablas, triggers y «nada más se movió»
   (funciones, relaciones, triggers y políticas; +7 EXECUTE para `authenticated`, 0 para `anon` y `service_role`).
2. **Gateway**: imagen con el allowlist CONNECTED-V1 ampliado. Sin 0022 aplicada, las RPC nuevas darían 404 de
   PostgREST; por eso la base va primero.
3. **Web** y, después, el **build nativo** (fase 1: CONNECTED + BRANDING).

Orden respecto de 0020 (sponsors) y 0021 (borrado de cuenta): 0022 no reemplaza ninguna función existente, así que
aplica antes o después de ambas. Ensayado en los dos órdenes con el 0021 commiteado de #217
(`evidence/order-0020-0021.txt`).

Borrado de cuenta: 0021 nunca borra la fila de identidad (la corta), así que los `ON DELETE` de 0022 no intervienen. La
compatibilidad la da la clasificación explícita de las tablas de 0022 en `private.erase_tournament_account` (0021, paso
«7b. Moderation»): reportes presentados por la persona sin reporter ni detalle, sus eventos `created` sin actor,
reportes sobre su contenido con el seudónimo del plantel / sin el mensaje de la solicitud, sus silencios y los bloqueos
donde es la bloqueada borrados, columnas de staff conservadas. Detalle en el diseño, §2.1.

## Recuperación

- Web → deploy anterior. Gateway → revisión anterior (las RPC dejan de servirse; la base queda igual).
- Base → `rollback-0022 ROLLBACK TORNEOS 0022 <ref> <sha12>`. **Se niega si hay reportes, eventos, silencios,
  bloqueos o retenciones**. Para descartarlos hace falta la frase de fuerza
  `… DISCARD MODERATION ROWS` (decisión explícita: se pierden los reportes). Lo ya moderado (nombres neutros, páginas
  dadas de baja) queda como está; una página retenida se puede volver a publicar después del rollback.

## Operación de la plataforma (rutina)

No hay panel de administración ni aviso por email (Torneos no envía emails y no se agrega un servicio pago).

- **Todos los días, a mano** (objetivo interno, no una promesa pública: primera revisión ≤ 24 h, decisión ≤ 48 h):
  `node backend/torneos/moderation-v1/remote/db-0022.mjs inbox` → JSON de sólo lectura con los reportes pendientes
  de la plataforma (y los escalados), la foto del contenido, el motivo, `ageHours`. Nunca muestra quién reportó.
- **Decidir**: `node …/db-0022.mjs act <reportId> <under_review|resolved|dismissed> <acción|none> <nota…> ACT TORNEOS 0022 <ref> <primeros 8 del reportId>`
  - Acciones: `take_down_tournament` (baja de página pública + retención + baja del catálogo con la palanca existente),
    `take_down_organization` (lo mismo para todos sus torneos), `release_tournament_hold`, `clear_organization_logo`,
    `clear_tournament_logo`, `revoke_announcement`, `block_applicant`, y las de la organización
    (`neutralize_team_name`, `remove_team_shield`, `neutralize_player_name`).
  - Todo queda en `tournament_content_report_events` y en `tournament_audit_log` (`actor_type = system`).
- **Baneo de una cuenta** (abuso grave o repetido): suspender el usuario en Core Auth (panel de Supabase Core). El
  gateway exige una sesión Core activa en cada pedido, así que la persona deja de poder usar Torneos.
- **Por email** (`arma2app@gmail.com`): un reporte que llega por email se resuelve con las mismas acciones; si hace
  falta un `reportId`, se puede crear el reporte desde la app con una cuenta del equipo.
