# Ensayo general del lanzamiento piloto (2026-10-08/09)

Se hizo sobre una **copia descartable** (`arma2-dress-rehearsal`, puertos 594xx, sólo loopback), separada del laboratorio compartido. Al laboratorio compartido no se lo tocó.

**Estado inicial igual al de Production:**
- **Core:** las 43 migraciones de `main` más `20261009120000`, con su ledger.
- **Torneos:** `0000–0008` (`POST_0008`), con los objetos a nombre de `postgres`. Así figura en la evidencia remota de Production (`installer_owns: true`).
- **Aplicación:** todo como `postgres` no superusuario, el rol que usa el instalador de Supabase.

**Herramientas:** las reales del procedimiento, en modo laboratorio:
- `ops_free_plan.py`;
- `core_apply.py`;
- `RUNBOOK-193` (`precheck`, `apply-193.psql`, `postcheck`);
- los drivers `db-0009-0011`, `db-0012` y `db-0015-0016`, sin cambios en su lógica.

**Web:** el candidato (sin cambios en `src` desde `4e4a3f17`) contra la copia.

## Secuencia

| Paso | Resultado |
| --- | --- |
| R0 | Datos semilla. **Core:** 5 cuentas con email, teléfono, nacimiento y ubicación en la fila; 3 partidos (uno publicado buscando jugadores, uno privado y uno con 2 invitados); 1 equipo. **Torneos:** organización, temporada y torneo. Se guardaron los digests |
| D0 | `backup-db` + `restore-check` estricto: **RESTORE VERIFIED** en Core (183 tablas, 669 filas, 0 diferencias) y en Torneos (125 tablas, 425 filas, 0 diferencias) |
| D2 | `core_apply`: `MIGRATION-20261007120000_DONE` y `MIGRATION-20261008120000_DONE` |
| D3 | `precheck` 13/13 · `apply-193.psql` **20/20** (`120000 → 139000`) · `postcheck` **21/21**. Digests de datos iguales a R0, incluidos los valores privados, que ahora están en `app_private` |
| Enlaces nuevos | Ver la sección siguiente |
| D4 | `APPLY_0009_DONE` (POST_0008 → POST_0009). **`0010` falló como `postgres`** (ver «Hallazgos»); corregido: `APPLY_0010_DONE`, `0011`, `0012`, `0014`, `0015` y `0016` DONE. `changedOutside = []` en cada paso. Datos de Torneos iguales a R0 |
| D5 | Gateway del candidato con los flags de Production (PLAN READ, Social): suite base 36/41. Los 5 fallos son de la estructura de la copia: puertos publicados, ledger del laboratorio, clave de Storage del overlay y conteos congelados de la línea base 0001. Los conteos reales (`anon` 16, `authenticated` 204) son los que esperan los drivers |
| D6 | `TORNEOS_CONNECTED_MODE=on`: suite conectada, recorridos B–D **6/6**. El caso A espera el cuerpo previo a 0011 |
| D7 | `TORNEOS_BRANDING_MODE=on`: **8/8** |
| D8 | `db-0012 mode MVP_SIMPLE` DONE + `TORNEOS_MEDIA_MODE=on`. Por el gateway: el participante intenta retirar, restaurar o publicar → 403 `42501`. El organizador retira la única foto publicada → galería en `draft`, que el participante deja de ver; restaura y republica → la ve de nuevo. Tope FREE 25/25 (`422 TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED`). Intentos de pasar a Premium → 403 |

## Enlaces nuevos de WhatsApp y votación de invitados (después de D3)

- El organizador, desde la web nueva («Menú de acciones» → «Enviar link de votación»), genera `/votar-equipos?codigo=…`.
- Un invitado sin sesión abre el link y ve «¿Quién sos?» con los nombres de los invitados. Elige «Invitado Uno», sigue sin foto, califica a 3 jugadores, confirma y ve «¡Gracias por votar! Tus votos fueron registrados.». En la base: `public_voters` completo y 3 votos. Sin login ni pasos adicionales; 0 errores HTTP.
- **Segundo intento con el mismo nombre:** «¡Ya votaste!»; los votos siguen en 3.
- **Código inválido:** «No encontramos ese partido».

## Recorrido piloto en la web del candidato (con todas las funciones)

| Paso | Resultado |
| --- | --- |
| Convocatoria | El organizador la completa, la publica y abre las solicitudes (`listed/open`, cupo 2) |
| Solicitud | El capitán ve sus 2 equipos de Core. Doble clic en «Crear solicitud», plantel 5/5 y doble clic en «Enviar»: después de recargar, 1 solicitud por equipo |
| Revisión | El organizador pide cambios con motivo; el capitán ve el motivo, corrige y reenvía. Las dos solicitudes quedan aprobadas |
| Cuentas ajenas | Otra organización, una jugadora y una cuenta sin equipos: 12 intentos → 403 `42501` |
| Fixture | Generar, publicar, sede, cancha F5, programar, «Voy» de la jugadora |
| Reprogramación | Con doble clic: 1 fila de historial (17/10 15:00 → 18/10 17:30). 3 avisos para 3 personas distintas (Ana, Beto y el capitán), sin `message` y sin el motivo |
| Avisos en pantalla | Ana y Beto (mobile) y el capitán (desktop) ven «Antes: sáb 17 oct, 03:00 p. m. · Ahora: dom 18 oct, 05:30 p. m.» y el aviso abre `/torneos/mis-partidos/<partido>` con «Reprogramado · antes era…». Sin desborde y 0 errores 4xx |

## Recuperación completa (en orden inverso)

1. **Flags apagados:** MEDIA → BRANDING → CONNECTED. El gateway queda como hoy: las RPC conectadas dan 403 y las de base, 200.
2. **Torneos:**
   - `db-0012 mode PROCESSOR_EXTERNAL` DONE (antes, `rollback-0012` **se negó** con el pipeline encendido, como corresponde);
   - después `rollback-0016` (borró 3 avisos), `0015`, `0014`, `0012` (se conservan 62 objetos de fotos), `0011`, `0010` y `0009`: todos DONE hasta **POST_0008**, con `changedOutside = []`;
   - la organización y el torneo de R0 siguen intactos; 0009 se lleva, como está documentado, las tablas del producto conectado.
3. **Core:** los rollbacks de `139000 → 135000` (archivos del runbook, `-1`) aplicados. Los valores privados de las 5 cuentas de R0 volvieron a la fila con **el mismo digest que R0** (`1d890ff7…`) y la columna `added_by` volvió. `rollback-push-preference` quedaba **bloqueado** (ver «Hallazgos»); corregido: `ROLLBACK-PUSH-PREFERENCE_DONE`.
4. **Último recurso:** la restauración completa de los backups de D0 está verificada por `restore-check` (restauración en un Postgres nuevo, 0 diferencias). Los rollbacks de `120000–134000` son SQL de `PROMOTION.md` §5 y no se ensayaron como archivos: para volver más atrás de `135000` se usa el backup.

## Hallazgos corregidos

| Hallazgo | Corrección |
| --- | --- |
| `0010` revocaba la regla de lectura de logos sólo de `PUBLIC`. Como `postgres` (el instalador de Production), los privilegios por defecto de Supabase le daban EXECUTE a `anon`, y la postcondición de la propia migración abortaba el lanzamiento. Ningún ensayo anterior lo vio: instalaban como `supabase_admin` | #182 `b03cec1a`: `revoke … from public, anon`. sha256 nuevo `55afd5e8…`, fijado en el driver y en `DEPLOY.md`. Premium sumó un test permanente que prueba 0013 con esos privilegios por defecto |
| `core_apply` se negaba a correr la contención de push después de RUNBOOK-193 («versions this runner does not know») | #182 `61963ce9`: una versión es conocida si su migración está en el checkout. La gemela LOCAL se sigue rechazando |

## No cubierto por el ensayo

- Teléfono físico.
- Realtime (el puente no reenvía WebSocket).
- Netlify real.
- La app de WhatsApp en sí: el link se abrió en un navegador.
- Mercado Pago, que queda fuera del alcance.

## Cierre del residual: planteles publicados sin identificadores ni puntajes (`140000` + `141000`, #193 `aa89bedd`)

Se verificó en una segunda copia descartable (`arma2-dress2`), con Core en `120000–141000` aplicadas como `postgres`.

### La app instalada 1.1.21 (`dad2a0b9`, bundle web en viewport de teléfono)

**Antes de `140000`:** una cuenta ajena veía los 9 nombres y «1» lugar.

**Después de `140000`:**
- la misma cuenta ve el plantel **vacío** (10 lugares libres);
- «Solicitar unirme» crea **una** solicitud pendiente: «Esperando aprobación del admin»;
- una vez involucrada, ve el plantel completo.

### Por la API (lo que puede hacer cualquier cliente)

| Prueba | Resultado |
| --- | --- |
| Cuenta ajena: tabla `jugadores` del partido publicado | 0 filas (`*/0`) |
| Cuenta ajena: «Quiero jugar», `get_public_match_roster` | 9 entradas, 0 `usuario_id`/`score` |
| Organizador | ve todo |
| Anónimo con el link (`public_get_match_by_code`) | 0 identificadores y puntajes; marca `has_account` para la votación |
| Sumarse insertándose en el plantel | 403 |
| Solicitud creada como «aprobada» | 403 |
| Doble toque al pedir sumarse | 201, después 409 `23505`: 1 sola solicitud |
| Tres aprobaciones simultáneas por el último lugar (10 titulares + 3 suplentes) | exactamente 1 entra; 2 reciben «El partido está completo (10 titulares + 4 suplentes)» |
| Organizador aprueba (`141000`), con un lugar libre y dos solicitudes a la vez | 1 aprobada; la otra, «El partido está completo»; reaprobar la misma → «El jugador ya está en el partido» |
| Una cuenta que no organiza intenta aprobar | 403 «Forbidden» |

### Link de WhatsApp y votación por nombre, con la web del candidato después de `140000`

- «¿Quién sos?» lista sólo a los invitados: las cuentas registradas no aparecen.
- Se vota a los 13 jugadores y se ve «¡Gracias por votar!». Sin login y 0 errores.

### Torneos con `140000`

Suite conectada: los recorridos B–D pasan 6/6. El contrato Core → Torneos no se afecta.

### Hallazgo previo, corregido en `141000`

Con los permisos de `main`, el organizador **no podía aprobar solicitudes** (`approve_join_request` → «permission denied»), probablemente también hoy en Production. El precheck del runbook lo informa.

### Fuera de esta copia

La función `approve-join-request` no corre en el laboratorio (404). Core la probó por la función real en su laboratorio (366/366), incluidas dos aprobaciones simultáneas.
