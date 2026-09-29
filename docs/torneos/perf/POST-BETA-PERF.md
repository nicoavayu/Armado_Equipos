# Torneos — performance post-beta (2026-09-28)

Base `main` 9f68e6d7 (beta en Production). Branch `claude/arma2-torneos-post-beta-polish`.

## Cómo se midió

- **Dónde:** laboratorio híbrido B04 local (`arma2-b04-hybrid-lab`): GoTrue/PostgREST Core reales, gateway del lab y DB Torneos del lab, todo en loopback. No se tocó Production.
- **Latencia:** un proxy loopback agrega **+2 s por llamada al gateway** (el piso de lo observado en Production: 2–5 s). Los preflights `OPTIONS` pasan sin demora.
- **Instrumento:** Resource Timing del navegador sobre el host del gateway (`performance.getEntriesByType('resource')`). No se agregó código de medición a la app.
- **Tiempos:** cada acción se mide desde el click hasta el fin de la última respuesta que la pantalla necesita.
- **Duplicados de dev:** la app corre bajo `React.StrictMode` (`src/index.js`), así que en dev cada lectura de montaje sale dos veces. Las tablas cuentan requests únicos, los mismos que hace el build de producción.

## Costo por llamada (servidor, leído del código; no se toca)

El gateway Edge (`backend/torneos/supabase/functions/torneos-gateway/index.ts`) hace estos pasos en serie en cada llamada. Cada uno es un viaje de red entre proveedores.

| Llamada | Pasos del servidor |
| --- | --- |
| `POST /exchange` | GoTrue `/user` → GoTrue `/health` → contrato Core `session` → upsert de identidad (DB Torneos) → firma del bearer |
| `POST /torneos/rest/v1/rpc/<name>` | verificación del bearer (local) → GoTrue `/health` → contrato Core `session` → chequeo de identidad (DB Torneos) → [adapter Core, sólo 4 RPC] → PostgREST |

En el lab la misma cadena tarda unos 20–60 ms, así que los 2–5 s de Production salen de esa cadena: red entre proveedores, cold starts y el contrato Core por llamada. Eso es **gateway/Core, fuera de alcance**. Lo que el frontend controla es **cuántas llamadas hace y cuántas quedan en serie**, y eso es lo que miden las tablas.

## Acciones

"Hops" son las llamadas que quedan en serie. La proyección a Production multiplica los hops por 2–5 s.

| Acción | Requests (antes) | Hops antes → después | Lab @2 s antes → después | Dependencia | Eliminable / paralelizable | Riesgo |
| --- | --- | --- | --- | --- | --- | --- |
| Cambio de pestaña Resumen ↔ Acta ↔ Revisión ↔ Historial | 2: `match_operations` → `match_operation`, detrás del loader de página completa | 2 → **0** | 4.1 s → **0 s**, sin loader | la página ya tiene los datos | **Hecho**: `load` ya no depende de la pestaña | bajo |
| → Convocatorias (1ª vez en el partido) | 4: `match_operations` → `match_operation` → 2× `match_squad` | 3 → **1** | 6.1 s → **2.0 s**, loader local | las convocatorias sólo necesitan la fila del partido (en memoria) | **Hecho**: sólo se leen las 2 convocatorias, en paralelo | bajo |
| → Convocatorias (otra vez) | 4 | 3 → **0** | 6.1 s → **0 s** | quedan en memoria hasta la próxima relectura | **Hecho** | bajo |
| Deep link a Convocatorias | … → `match_operations` → `match_operation` → 2× `match_squad` | último tramo 2 → **1** | −2 s | acta y convocatorias sólo dependen de la fila | **Hecho**: acta ∥ convocatorias | bajo |
| Miembros por navegación interna | 4: `members` ∥ `invitations` ∥ `competition` → `season_assignments` | 2 → **1** | 4.1 s → **2.0 s** | las temporadas ya están en el contexto de la organización | **Hecho**: temporadas desde el provider; sin segundo `competition` | bajo |
| Miembros por deep link | `exchange` → `workspace` → `members` ∥ `invitations` ∥ `competition` ×2 → `season_assignments` (+ `fixture` ∥ `schedule`) | 4 → 4 (una llamada menos) | 10.4 s → 8.5 s* | los accesos necesitan `seasonId`, que sale de `competition` | Queda: un RPC que devuelva miembros + temporadas + accesos juntos | backend/DB |
| Deep link a un partido (Resumen) | `exchange` → `workspace` → `competition` → `match_operations` ∥ `fixture` ∥ `schedule` → `match_operation` | 5 → 5 | 10.3 s → 10.4 s | bearer → membresía (guard fail-closed) → catálogo → fila → acta | `fixture`/`schedule` no los usa esta página (están fuera del camino crítico). El orden `workspace` → `competition` es el diseño fail-closed del guard | arquitectura |
| Entrar a otra organización | +`set_tournament_workspace_preference` antes del catálogo | +1 | +2 s | el guard espera la activación | hacerla en paralelo cambia la semántica de activación | arquitectura |
| Acción en acta / convocatoria | mutación → relectura en segundo plano `match_operations` → `match_operation` (→ convocatorias) | 1 + 2–3 | — | la fila del partido cambia de estado | algunas RPC devuelven su contexto (`save_match_squad`), pero la fila del listado quedaría vieja: se mantiene la relectura (sin loader desde cfca3888) | medio |
| Invitar miembro (~11 s en Production) | 1 RPC; la relectura de invitaciones corre después y no bloquea el enlace | 1 | lab ~60 ms del servidor | — | nada del lado frontend: es el piso por llamada más el SQL | gateway/DB |
| Foco de pestaña / refresh de sesión | SIGNED_IN de la misma sesión en cada hidden → visible: el transport descarta el bearer | +1 exchange en la próxima acción; +2 si el foco cae durante un exchange (reproducido en el lab, sin logout falso) | +2–4 s | contrato RACE-2 (`session-race.test.mjs`) | conservar el bearer cuando el token Core no cambió es un cambio del contrato de auth certificado: **decisión aparte** | auth |
| Fixture/programación en toda página de organización | `fixture` ∥ `schedule` al entrar a cualquier página de la organización (Partidos y Miembros no los usan) | 0 (en paralelo) | — | provider montado por el guard | provider perezoso (sólo cuando una página lo pide) | medio (varias páginas) |

\* En el lab la diferencia del deep link a Miembros viene de las lecturas duplicadas de StrictMode: sin ellas, el pool de 6 conexiones HTTP/1.1 del bridge ya no encola. En Production no hay StrictMode, así que la ganancia es una llamada menos con los mismos 4 hops.

**Proyección a Production (2–5 s por hop):**

| Acción | Antes | Después |
| --- | --- | --- |
| Cambio de pestaña del partido | 4–10 s detrás del loader (el "~10 s" de la beta) | 0 s |
| Primera vez en Convocatorias | 6–15 s | 2–5 s, con loader local |
| Miembros por navegación interna | 4–10 s | 2–5 s |

## Fuera de alcance (documentado, sin cambios)

- **Gateway/Core:** el costo por llamada (contrato Core `session` en cada RPC, health de GoTrue en cada RPC). Un cache corto del veredicto de sesión en el gateway bajaría todo, pero es una decisión de seguridad del gateway.
- **Backend/DB:** un RPC agregado para Miembros (miembros + temporadas + accesos). También se podrían devolver acta y fila juntas tras cada acción.
- **Auth:** el re-exchange por foco (RACE-2).
- **App Core (no Torneos):** en cada SIGNED_IN, la app Arma2 relee `usuarios`, `jugadores`, `player_awards` y `partidos_manuales` contra Core. No pasa por el gateway de Torneos.

## Medir en Production sin tocar nada

Con la sesión abierta en `/torneos`, pegar en DevTools → Console:

```js
performance.setResourceTimingBufferSize(5000);
window.__t0 = performance.now();
// …hacer la acción (cambiar de pestaña, abrir Miembros)… y después:
performance.getEntriesByType('resource')
  .filter((e) => e.startTime >= window.__t0 && /\/(exchange|torneos\/rest\/v1\/)/.test(e.name))
  .map((e) => ({ call: e.name.split('/').pop(), start: Math.round(e.startTime - window.__t0), ms: Math.round(e.duration) }));
```

Sólo lee tiempos que el navegador ya registró: no envía nada ni muestra tokens.
