# QA LOCAL de Torneos — arranque reproducible y fail-closed

## El riesgo que este procedimiento cierra

`.env.local` apunta a un Supabase **remoto**. Create React App lo lee siempre,
salvo que la variable venga pisada en el proceso. Es decir: hasta ahora una
sesión de QA LOCAL correcta dependía de que quien la arrancara se acordara del
override, y olvidarlo no rompía nada visible — sólo movía el QA, y sus
escrituras, al proyecto remoto.

Comprobado el 2026-08-13 sobre el dev server vivo de este worktree:

| Origen | Destino |
| --- | --- |
| `.env.local` en disco | `https://rcyuuoaqfwcembdajcss.supabase.co` (remoto) |
| entorno del proceso vivo | `http://127.0.0.1:57321` (LOCAL) |

La sesión estaba bien; lo que estaba mal era que **sólo un override de proceso
la separaba del remoto**.

## Arranque

El default queda invertido: sin un destino loopback explícito no hay app.

```bash
QA_SUPABASE_URL=http://127.0.0.1:57321 QA_SUPABASE_ANON_KEY=<anon key LOCAL> npm run qa:start:local -- --start
```

Sin `--start` sólo verifica el destino y lo informa, sin arrancar nada.

El guard (`assertLocalAppTarget`, en `scripts/qa/production-guard.js`) rechaza:

- que falte cualquiera de las dos variables — no hay fallback ni archivo;
- cualquier destino que no sea `http://` sobre loopback, **incluido el proyecto
  remoto de QA autorizado**, que para una sesión LOCAL sigue siendo remoto;
- el ref de Production, que ni siquiera llega a evaluarse como destino;
- una anon key que lleve adentro el `ref` de un proyecto hospedado, aunque la
  URL diga loopback: la key delata el destino real.

Las variables se le pasan al proceso hijo ya resueltas, así que CRA nunca
consulta los archivos `.env*`. No queda ninguna ruta por la que el valor remoto
pueda volver a colarse.

Cobertura: `npm run test:qa:guards`.

## Tooling de PostgREST en LOCAL

Al reemplazar funciones, PostgREST pierde el cache de esquema y no lo
reconstruye: la introspección supera el `statement_timeout` del rol
`authenticator` y todas las rutas devuelven 503 `PGRST002`. No es un fallo de
producto.

```sql
alter role authenticator set statement_timeout = '120s';
```

Después, recargar el cache. `notify pgrst, 'reload schema';` alcanza; un
`analyze;` también lo destraba.

## Base de datos

- Postgres LOCAL: `postgresql://postgres:postgres@127.0.0.1:57322/postgres`
- Para reproducir lo que ve PostgREST —incluido `safeupdate`— hay que conectarse
  como `authenticator`: `postgresql://authenticator:postgres@127.0.0.1:57322/postgres`.
  Es el único rol que lo tiene precargado; `postgres` no puede hacer
  `LOAD 'safeupdate'`.
