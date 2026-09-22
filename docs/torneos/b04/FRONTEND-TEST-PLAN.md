# FRONTEND-TEST-PLAN — B04

> **Estado 2026-09-21:** documento de la foundation (pre-R4). La integración B04 está implementada y verificada; la referencia vigente es [B04-FRONTEND-INTEGRATION-REPORT.md](B04-FRONTEND-INTEGRATION-REPORT.md). Lo que abajo dice «futuro», «reservado» o «desactivado» ya no aplica.

## Tests agregados

`npm run test:torneos:frontend-foundation`

13 tests offline, ejecutando módulos reales mediante Babel en sandbox y auditando imports/llamadas con AST:

1. Alias Core y legacy comparten exactamente el singleton, opciones Auth y archivo original.
2. Scope frontend igual a las 43 operaciones de Phase 2D, sin ampliación.
3. Los 43 métodos permitidos rechazan sin transporte, incluso con argumentos de activación/fallback.
4. Las 126 RPC legacy fuera de scope y nombres arbitrarios/prototype/path injection rechazan antes del transporte.
5. Configuración separada, vacía por defecto y siempre desactivada.
6. Rechazo de aliases parciales/conflictivos, URLs inválidas y colisión Core/Torneos.
7. No crecen dependencias Core ni accesos backend legacy transitivos.
8. Mutaciones negativas: import Core directo/alias/transitivo, segundo login, SDK adicional, RPC literal/dinámica/computed, setSession, fetch, persistencia e import calculado.
9. Detección de credenciales privilegiadas/JWT, URLs y refs hardcodeados, incluido Production.
10. Escaneo de líneas nuevas/cambiadas en frontend/config contra esos patrones.
11. Foundation desconectada del runtime, sin inicialización de SDK ni llamadas de red.
12. Inventario RPC sin dispatch sin resolver y backend/migrations sin diff.
13. Excepciones legacy iguales a la auditoría de objetos Git de `2058da03`, no una lista ampliable desde HEAD.

El script se ejecuta al inicio de `test:ci`. Requiere dependencias de desarrollo ya presentes y acceso a la base Git `2058da03` (un checkout CI superficial debe traer ese objeto). La suite usa Node 20.11+ por `import.meta.dirname`; se ejecutó con Node 25.2.1.

## Regresión seleccionada

Se ejecutaron estas seis suites existentes con `CI=true`, URL y clave públicas ficticias y sin servicios remotos:

- `torneosIsolatedSso.test.js`
- `torneosFeatureFlags.test.js`
- `tournamentWorkspaceService.test.js`
- `tournamentTeamsService.test.js`
- `tournamentCompetitionService.test.js`
- `torneosRuntimeIsolation.test.jsx`

Comando reproducible:

```sh
CI=true REACT_APP_SUPABASE_URL=https://core.example.test REACT_APP_SUPABASE_ANON_KEY=public-placeholder node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand --runTestsByPath src/__tests__/torneosIsolatedSso.test.js src/__tests__/torneosFeatureFlags.test.js src/__tests__/tournamentWorkspaceService.test.js src/__tests__/tournamentTeamsService.test.js src/__tests__/tournamentCompetitionService.test.js src/__tests__/torneosRuntimeIsolation.test.jsx
```

## Resultados

- Foundation: **13/13 aprobados**.
- Regresión: **6/6 suites, 76/76 tests aprobados**.
- Advertencias de las suites existentes: deprecación `ReactDOMTestUtils.act` y future flags de React Router; sin fallos.
- ESLint de los cinco módulos frontend nuevos: aprobado, sin warnings.
- Validación del diff: sin cambios en backend/torneos, migrations o singleton actual; sin errores de whitespace.

No se ejecutó la suite completa `test:ci`, build de producción ni pruebas de conectividad/E2E de R2/R3/R4. Esta validación prueba la foundation offline y regresiones seleccionadas; **no certifica el híbrido ni constituye B04 PASS**.

## Reproducción del inventario

`node scripts/torneos-frontend/report.mjs` reconstruye el JSON y mapa de llamadas desde la base exacta. No recoge excepciones de cambios nuevos. El guard permite código legacy existente como deuda inventariada; no lo declara seguro o migrado.

Antes de integrar transporte, añadir tests del contrato certificado para logout, refresh, cambio de usuario, respuestas tardías, errores de gateway, DTOs/roles y destinos. Comprobar que no existen fallback a Core ni rutas legacy fuera de staging-v1 en la nueva composición.
