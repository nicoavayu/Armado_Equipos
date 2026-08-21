# Arma2 Torneos · entitlements históricos

Este documento describía la fundación temporal FREE/PRO por organización de
`20260810160355_tournament_entitlements_foundation.sql`. Esa migración y sus
rows se conservan para trazabilidad, pero dejaron de ser la autoridad comercial.

El contrato vigente es FREE/PREMIUM permanente por edición de torneo y está
documentado en [torneos-plan-experience.md](./torneos-plan-experience.md).

Compatibilidad preservada:

- los datos y el historial multimedia no se purgan al cambiar de modelo;
- `get_effective_tournament_entitlements` conserva su firma y ahora devuelve el
  schema V2 por torneo;
- las tablas históricas se renombran con prefijo `tournament_legacy_` y no
  conceden acceso;
- el setter temporal anterior queda deshabilitado;
- los torneos existentes reciben `PREMIUM / legacy_grant`, nunca una compra.
