# Propuesta: extensión de `authorizedStages` a deploy y habilitación

**No aplicada.** `ops/torneos-staging/manifest.json` sigue con `authorizedStages: ["A1","A2"]` y `authorizedStagesProposal.applied: false`. `scripts/torneos-staging/readiness-lib.mjs` aborta con `STAGE_PROPOSAL_APPLIED` si alguien pone ese campo en true sin cambiar el resto del contrato. Este documento existe para que la extensión se apruebe con el texto exacto a la vista, no para habilitarla.

## Situación

`AUTHORIZED_MANIFEST_STAGES` es la lista cerrada de etapas de **migración** ejecutables: A1 (`20260802090000`) y A2 (`20260802120000`), ambas ya aplicadas en Staging. Social (`20260803090000`) queda explícitamente bloqueada.

Las etapas de deploy y habilitación del pipeline — `storage`, `edge-deploy`, `attest`, `enable-multimedia` — existen en `manifest.stages` con su orden y su tipo de aprobación, pero **ninguna es ejecutable por el contrato**: no tienen identificador de etapa autorizada, así que `apply-single-migration.mjs` y el resto de la CLI no pueden correrlas. Hoy se ejecutan a mano bajo aprobación humana.

## Extensión propuesta

Cuatro identificadores nuevos, uno por mutación, cada uno con su propia aprobación. Ninguno agrupa dos mutaciones.

| Etapa | Mutación | Aprobación | Requiere aplicado antes | Reversible por |
|---|---|---|---|---|
| **A3** | `storage`: crear el bucket privado `tournament-media` y sus 4 policies de servicio | por etapa | A1, A2 | dejar el bucket, revocar policies con aprobación separada |
| **A4** | `edge-deploy`: desplegar `tournament-media-signer`, pausar, verificar, desplegar `tournament-media-processor` | **por función**, con pausa obligatoria entre las dos | A3 | restaurar release anterior registrado |
| **A5** | `attest`: correr el health del signer y el self-test del worker hasta que `uploadReady` sea true por evidencia | por servicio | A4 + worker y renovador provisionados | revocar atestación |
| **A6** | `enable-multimedia`: poner `REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED=true` en Staging | por etapa | A5 + observabilidad desplegada y validada | bajar el flag |

Texto exacto propuesto para `readiness-lib.mjs`:

```js
export const AUTHORIZED_MANIFEST_STAGES = Object.freeze(['A1', 'A2']);
export const AUTHORIZED_DEPLOYMENT_STAGES = Object.freeze(['A3', 'A4', 'A5', 'A6']);
```

Dos listas, no una. Las migraciones y los despliegues no comparten allowlist: una etapa de deploy nunca debe poder autorizar una migración por confusión de identificador, y la validación de `migrationPolicy.migrations` debe seguir exigiendo que exactamente `AUTHORIZED_MANIFEST_STAGES.length` migraciones lleven autorización.

Texto exacto propuesto para el manifiesto:

```json
"authorizedStages": ["A1", "A2"],
"authorizedDeploymentStages": ["A3", "A4", "A5", "A6"],
"authorizedStagesProposal": { "applied": true, "approvedBy": "<humano>", "approvedAt": "<fecha>" }
```

## Precondiciones para aprobar

Ninguna de estas está cumplida hoy:

1. Observabilidad desplegada y validada en Staging (`catalog.validatedInStaging: true` con evidencia de alertas disparadas y recuperadas).
2. Renovador de la atestación del signer corriendo como servicio, con dos renovaciones consecutivas observadas y una falla provocada que alertó y se recuperó.
3. Revisión de `service_role` del worker cerrada, con la decisión registrada (ver [revisión de credencial de servicio](tournament-media-service-role-review.md)).
4. Prueba de rollback de A3 y A4 en Staging: bucket y funciones restaurados a estado anterior sin pérdida de datos.
5. Prueba de revocación: revocar la atestación del signer cierra `uploadReady` en menos de un ciclo de lectura.
6. Cada etapa nueva con sus tests negativos: aprobación faltante, token inválido, receipt de etapa previa ausente, drift de checksum, drift de SHA de repositorio, y flag de producción en true.

## Riesgos de aplicarla antes de tiempo

- **A4 sin A5 verificada** deja funciones desplegadas que pueden firmar URLs contra un bucket cuyo contrato todavía no fue probado end to end.
- **A6 sin observabilidad** abre uploads con un pipeline ciego: el modo de falla exacto que la auditoría marcó.
- **Un único identificador para deploy + enable** haría que una sola aprobación humana cubriera dos mutaciones con radios de daño distintos.
- **Reutilizar A1/A2 para deploy** rompería la invariante de "exactamente una migración por etapa autorizada", que es lo que hoy hace imposible aplicar Social por accidente.

## Qué NO propone

No propone habilitar Social, ni tocar `20260803090000`, ni ninguna etapa en producción. `flags.productionForcedFalse` se mantiene, y `environment.production: "always-reject"` no cambia bajo ninguna versión de esta propuesta.
