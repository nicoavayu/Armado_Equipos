# R4 — Hybrid Gateway Certification: preflight y plan

Estado: **STOP — plan solamente; R4 no ejecutado**.
R3 + D1 aceptados y cerrados por el usuario. Sin R5, frontend, B04, Production, commit, push ni PR.

## 1. Observaciones actuales y condiciones de inicio

- Worktree: `plan-r2-local-f7ace5`; último commit previo `945eeac6`.
- R2 NO está levantado: `torneos-db` y `torneos-rest` están `exited`, exit 255, FinishedAt 2026-09-17T16:14:29Z. No se infiere la causa del cierre.
- Volumen `arma2-torneos-isolated-local_torneos-data` presente. No se hizo start, reset, up, down ni destroy.
- `127.0.0.1:58430`: conexión rechazada. No se pudo revalidar catálogo/ACL/datos en vivo.
- `127.0.0.1:58431`: sin listener; bind local temporal exitoso, socket cerrado inmediatamente. Gateway no iniciado.
- Imagen DB existente: `sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453`.
- Imagen REST existente: `sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326`.
- Imagen Edge v1.74.2 disponible localmente: `sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45`.
- `.runtime/torneos-gateway.env` NO existe. El perfil Compose gateway existe, pero falta el runner de configuración/certificación híbrida R4.
- No ejecutar `lab.mjs up/reset/destroy`: son flujos de instalación/reset, no reanudación conservadora. Incluso `status` llama `prepare()`; este preflight usó Docker inspect/ps directamente.

Tras aprobar ejecución: arrancar exclusivamente los dos contenedores existentes de R2, conservando volumen/configuración; esperar health y REST, revalidar catálogo/aislamiento con consultas de lectura. Si difieren del baseline certificado: STOP, sin reinstalar automáticamente. Mantener R2 levantado al finalizar.

## 2. Arquitectura y targets exactos

| Componente | Target |
|---|---|
| Core staging permitido | `hhyvmhgpapyuzjgxfnqv` |
| Core Auth e issuer Core | `https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1` |
| Core contract | `https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract` |
| Gateway público local | `http://127.0.0.1:58431/torneos-gateway` |
| Exchange | `POST /torneos-gateway/exchange` |
| Gateway REST | `/torneos-gateway/torneos/rest/v1/…` |
| Torneos REST desde gateway en Docker | `http://torneos-rest:3000` |
| Torneos REST desde host | `http://127.0.0.1:58430` |
| DB local desde gateway | `torneos-db:5432/postgres`, dos roles limitados |

No usar `127.0.0.1:58430` dentro del contenedor gateway: apuntaría al propio contenedor.
No ejecutar `remote/deploy-torneos-gateway.sh`: es el flujo hospedado, no R4 híbrido local.

## 3. Secrets y configuración: nombres únicamente

Secretos requeridos por el gateway:

- `TORNEOS_CONTRACT_SERVICE_SECRET`
- `TORNEOS_BRIDGE_KEYS`
- `TORNEOS_DB_IDENTITY_WRITER_URL`
- `TORNEOS_DB_CORE_ADAPTER_URL`

Configuración requerida, no secreta:

- `TORNEOS_GATEWAY_PUBLIC_URL`
- `TORNEOS_ALLOWED_ORIGIN`
- `CORE_AUTH_URL`
- `CORE_JWT_ISSUER`
- `CORE_CONTRACT_URL`
- `TORNEOS_REST_URL`

Opcionales en código:

- `CORE_ANON_KEY`: suministrar para Core remoto; clave pública.
- `TORNEOS_ANON_KEY`: omitir en REST local directo, sin Kong.
- `TORNEOS_DB_SSL_CA`: omitir para transporte DB local actual; no cambiar TLS de servicios remotos.

PAT y credenciales QA pertenecen únicamente al operador/harness, nunca al gateway. Ningún Core service_role se inyecta en Torneos ni browser. Si se necesita provisionar QA, hacerlo en proceso separado de control, con identidad sintética marcada y cleanup limitado a sus propios IDs.

## 4. Custodia del contrato y key ring

- Keychain `arma2-torneos-nonprod-core / contract-secret`: PRESENT, check sin lectura de valor.
- En ejecución reutilizar exactamente esa entrada; sin rotación ni nuevo set-secrets en Core. Lectura en memoria y traspaso por stdin; nunca argv, stdout, logs o evidencia.
- El Compose actual espera un env_file; el runner R4 debe resolver inyección efímera en memoria mediante override/env de proceso, sin escribir el secreto remoto a `.runtime/torneos-gateway.env`. Docker puede retener env en metadatos del contenedor: no usar inspect sin proyección ni capturar compose config; al retirar gateway, retirar ese contenedor. Si no se implementa esta custodia, STOP.
- Key ring local existente en `.runtime/config.json`, modo 0600: `p3b-k1` activa y única confiable, `p3b-k2` standby no confiable.
- Ambas RSA 2048; correspondencia privada/pública comprobada sin imprimir material.
- `.runtime/public/jwks.json` coincide con pública activa; publica solo `p3b-k1`. Modo 0644, apropiado para material público.
- Reutilizar ring R2 para no romper confianza de PostgREST. No generar otra ni sustituirla por la del runner remoto. No rotación durante R4.

## 5. Issuer, audience, TTL y binding

Bearer Torneos: RS256, `typ=JWT`, issuer `urn:arma2:local:identity-bridge`, audience `arma2-torneos-local`, TTL exactamente 120 s (`exp-iat=120`), `nbf=iat`, tolerancia de reloj 5 s. `role=authenticated`; `sub` identidad local; `core_user_id`, `session_id`, `jti` UUID obligatorios.

Core bearer de entrada: issuer Auth indicado arriba, audience/role `authenticated`; verificación online GoTrue `/user`, luego veredicto `/v1/session`. Exchange no admite identidad/rol enviados por el cliente.

Sin segundo login significa: una sesión Core por actor QA para toda su secuencia; exchange no realiza login Torneos. Cross-user requiere al menos dos actores, cada uno con su propia sesión; no compartir sesiones ni hacer relogin para disimular revocación.

## 6. Allowlist exacta de 43

Copias Phase 2D y Edge idénticas. SHA256: 149c7659f27aa6d61b512c44e1b0b0fa1bff700d4a0a3f9bdb4024418227b78c.
Allowlist y gate disjuntos. Incluir cada nombre en inventario/resultado, sin equiparar admisión por allowlist con certificación funcional individual.

1. `create_tournament_organization`
2. `update_tournament_organization`
3. `is_tournament_organization_slug_available`
4. `is_tournament_organization_member`
5. `has_tournament_organization_capability`
6. `has_tournament_capability`
7. `tournament_role_capabilities`
8. `get_my_tournament_memberships`
9. `get_tournament_workspace_context`
10. `set_tournament_workspace_preference`
11. `set_active_tournament_context`
12. `assign_tournament_season_member`
13. `remove_tournament_season_member_assignment`
14. `list_tournament_season_member_assignments`
15. `has_tournament_season_access`
16. `has_tournament_season_capability`
17. `create_tournament_season`
18. `update_tournament_season`
19. `create_tournament_with_defaults`
20. `update_tournament_configuration`
21. `change_tournament_status`
22. `save_tournament_category`
23. `get_tournament_competition_context`
24. `get_tournament_creation_eligibility`
25. `has_organization_consumed_free_tournament`
26. `create_tournament_team_entry`
27. `update_tournament_team_entry`
28. `submit_tournament_team_entry`
29. `withdraw_tournament_team_entry`
30. `archive_tournament_team_entry`
31. `get_team_registration_context`
32. `get_tournament_teams_context`
33. `can_read_tournament_team_entry`
34. `is_tournament_team_manager`
35. `add_tournament_roster_player`
36. `update_tournament_roster_player`
37. `remove_tournament_roster_player`
38. `create_tournament_provisional_player`
39. `search_tournament_players`
40. `invite_tournament_team_manager`
41. `accept_tournament_team_invitation`
42. `search_tournament_arma2_teams`
43. `review_tournament_team_entry`

## 7. Gate: 32 OFF + una ruta padre = 33

El manifiesto revoca EXECUTE a anon/authenticated, conserva service_role. Padre adicional: `auto_schedule_tournament_matches` → `schedule_tournament_match`.
Confirmado estáticamente y en evidencia histórica R2; **ACL actual pendiente de lectura en vivo** porque R2 está detenido.
En ejecución: 33 nombres × POST/GET gateway → 403 `rpc not enabled`, sin pasar a PostgREST; acceso directo REST anon y authenticated → denegación SQL antes del cuerpo. Probar también variantes de método/ruta y sin bearer, sin tratar un 401 inicial como prueba suficiente del gate.

- `authorize_tournament_social_export`
- `cancel_tournament_purchase`
- `change_tournament_media_gallery_state`
- `create_tournament_disciplinary_override`
- `create_tournament_match_correction`
- `create_tournament_points_adjustment`
- `get_tournament_player_portrait_ref`
- `get_tournament_purchase`
- `has_tournament_entitlement`
- `lock_tournament_roster`
- `make_tournament_match_official`
- `mark_tournament_suspension_served`
- `publish_tournament_fixture`
- `record_manual_match_availability`
- `reopen_tournament_participants`
- `report_tournament_media_asset`
- `request_tournament_match_correction`
- `resolve_tournament_qualification`
- `review_tournament_match_operation`
- `revoke_tournament_player_portrait_publication`
- `revoke_tournament_points_adjustment`
- `revoke_tournament_team_photo`
- `save_tournament_draw_pots`
- `schedule_tournament_match`
- `set_tournament_player_portrait_crop`
- `set_tournament_player_portrait_editorial_status`
- `submit_match_squad`
- `supersede_tournament_fixture`
- `transition_tournament_media_asset`
- `update_draft_fixture`
- `validate_tournament_match_operation`
- `void_tournament_match_event`
- `auto_schedule_tournament_matches` (padre adicional)

## 8. Matriz de certificación propuesta (no ejecutada)

| Caso | Resultado exigido / evidencia |
|---|---|
| Exchange válido | Core bearer real → 200; JWT Torneos válido, 120 s, identidad estable en repetición; sin login adicional |
| Token válido | RPC/lectura permitida de fixture propio; sesión consultada online en cada request |
| Issuer incorrecto | JWT firmado con clave de test, iss cambiado → 401; sin efecto DB |
| Audience incorrecto | aud cambiado → 401; sin efecto DB |
| kid incorrecto/standby | kid desconocido y p3b-k2 no trusted → 401 |
| Expirado | exp fuera de tolerancia 5 s → 401 |
| TTL incorrecto | Token bien firmado con exp-iat distinto de 120 → 401 |
| Claims adicionales inválidos | nbf distinto de iat, futuro, UUID inválido, role service_role, alg none → 401 |
| Request binding | Attestation de payload A no autoriza payload B; path/body/time alterados en HMAC rechazados |
| Session/identity binding | Session de otro usuario, core_user_id/sub intercambiados, identidad inexistente → DENY, cero mutación |
| Replay | Repetir nonce HMAC → 401 REPLAY; attestation consumida → DENY; evaluar por separado idempotencia de RPC |
| Logout/revocación | Mismo bearer Torneos aún no expirado tras logout local Core → denegado, sin refrescar ni relogin |
| Core session inactive | Sesión inexistente o revocada → rechazo de exchange y REST, sin fallback |
| Core contract unavailable | Fallo aislado del canal de contrato → 503 CORE_UNAVAILABLE en exchange y REST válido; sin mutación |
| Respuesta Core stale/malformada | checked_at/captured_at fuera de ventana 0–3 s, schema inválido → 503 CORE_UNAVAILABLE |
| Core Auth unavailable | Medir por separado: código actual produce 503 access denied; no confundir con caída del contrato |
| Torneos REST unavailable | Solo camino REST interrumpido → 503 access denied, nunca 200 ni fallback; Core permanece operativo |
| Allowlist 43 | Inventario exacto y dispatch; fixture funcional por RPC o cobertura explícita, nada marcado PASS por un simple no-403 |
| 32 gated + padre | 33 bloqueadas por gateway y DB; no writes; comprobar estado antes/después |
| P0 review_tournament_team_entry | approve, reject, changes_requested; owner/admin asignado válidos; payload/roster inválido rechazado; auditoría correcta |
| Cross-user | Lecturas/RPC de actor ajeno rechazadas o filtradas por RLS; snapshots sin cambios |
| Cross-workspace | Workspace ajeno y organization_id manipulado → DENY |
| Cross-season | Admin sin asiento o con asiento en otra season → DENY; asiento correcto → PASS |
| No cache/stale | Instrumentar conteos de llamadas a sesión, headers no-store, PostgREST JWT cache 0; logout/outage inmediato |
| Secret boundary | /config, JWKS, respuestas, logs y evidencia sin PAT/HMAC/privadas/service_role/password/bearers |
| Aislamiento | Sin DB Core, DB local sin egress, sin FDW/dblink/http, ninguna ruta de fallback |

Bearer JWT no es de un solo uso: reutilizarlo durante una sesión activa es comportamiento esperado. “Replay” se exige en nonce HMAC y attestations, no como prohibición global de reutilizar el bearer. Las RPC idempotentes requieren aserciones propias sobre ausencia de efectos duplicados.

“No cache” se aplica a tokens/veredictos/datos de autorización. El runtime sí reutiliza workers/módulos y mantiene configuración/key ring/pools; eso no debe confundirse con cache de sesión. Si se exige literalmente cero reutilización de cualquier tipo, el runtime actual no lo cumple.

## 9. Ejecución futura y fault injection

1. Reanudar R2 existente y verificar health, imágenes, catálogo, ACL, RLS, gate y aislamiento de red con lecturas. Capturar baseline de filas de fixture/catálogos.
2. Crear runner R4 de targets cerrados y credenciales en memoria; validar targets exactos antes de leer secretos. No ejecutar suites históricas sin adaptar: varias arrancan Core local o alteran su propio lab.
3. Reutilizar ring R2 y secreto Keychain; configurar gateway local; iniciar exclusivamente perfil gateway, sin recrear DB/REST ni descargar imágenes sin revisar.
4. Provisionar actores QA sintéticos dedicados con IDs registrados; una sesión por actor; no usar cuentas existentes. Las claves administrativas quedan solo en el harness de control externo al gateway. Auth puede crear filas mediante triggers: inventariarlas para cleanup.
5. Preparar fixtures locales exclusivos (workspace/season/roster/P0), etiquetados por run; ejecutar matriz positiva, negativa y aislamiento.
6. Inyectar fallos mediante interceptor/proxy de test restringido o reglas por proceso/canal del gateway; nunca apagar Core remoto ni detener R2. Toda instrumentación temporal debe registrarse y retirarse. No considerar un mock unitario equivalente a la prueba del gateway Edge real.
7. Revocar sesiones al final; mismo bearer debe fallar inmediatamente; verificar auth.sessions. Retirar fixtures locales y QA remoto propios, conservar evidencia sanitizada.
8. Comparar baseline/estado final, emitir veredicto; STOP sin R5/B04/frontend.

## 10. Rollback / cleanup

- Ante fallo: no avanzar ni relanzar ciegamente; guardar fase/error sanitizado y estado.
- Mantener R2 y volumen. Retirar únicamente gateway y componentes temporales de fault injection; sin compose down -v, reset ni destroy.
- Borrar exclusivamente fixtures identificados por run, en orden de FK; comparar conteos/hash antes/después. Si cleanup falla, evidencia con IDs y STOP, sin borrar indiscriminadamente.
- Logout de sesiones QA, verificación de ausencia y eliminación de usuarios creados por el run; incluir perfiles generados por triggers en verificación.
- No rollback de R3, no borrar/rotar secreto Core, no alterar ring R2, no modificar seis QA preexistentes.

## 11. Evidencia propuesta

Archivos nuevos, timestamp UTC, sin sobrescritura, modo 0600 para JSON/logs; SHA256 y manifest de fuentes/imágenes:

- `r4-preflight-<UTC>.json`: estado inicial, targets, metadatos de keys, nombres de secrets, custody, 43/33, bloqueos.
- `r4-gateway-start-<UTC>.json`: imágenes, redes, puertos, health/JWKS públicos, sin environment completo.
- `r4-matrix-<UTC>.json`: caso, esperado/observado, resultado, efectos DB, cobertura exacta, llamadas de sesión.
- `r4-isolation-<UTC>.json`: redes, extensiones, servidores externos, rutas y targets efectivos.
- `r4-cleanup-<UTC>.json`: sesiones/QA/fixtures/componentes propios eliminados y R2 aún healthy.
- `r4-summary-<UTC>.json`: PASS solo con todos los casos obligatorios + cleanup; pendientes explícitos.
- `r4-terminal-<UTC>.log`: resumen sanitizado, nunca headers/env/dumps crudos.

## 12. Production, DB-to-DB y fallback

**Este preflight realizó 0 requests remotos, por lo tanto 0 acceso a Production.** Solo lecturas locales, check Keychain y bind temporal loopback. R3/D1 se aceptan por evidencia previa; no se consultó Core nuevamente.

Production `rcyuuoaqfwcembdajcss` sigue prohibido. Antes de R4, agregar allowlist exacta de egress para el gateway/harness (Core staging y servicios locales), denegar redirecciones y ref Production en cada entrada. El código actual tiene denylist de Production, pero acepta otros hosts HTTPS y el perfil egress de Docker no tiene firewall restrictivo: no equivale a una prueba de imposibilidad de acceso a cualquier destino.

Compose no contiene Core DB; DB local solo tiene red isolated; gateway accede a SU DB mediante dos roles limitados y a Core mediante HTTPS. **Gateway→DB Torneos no es DB-to-DB.** El esquema propuesto omite ese enlace técnico, necesario para identidad/attestations.

No hay fallback de configuración en config.ts ni veredicto stale autorizado en el camino de sesión: cada request pasa activeSession. Ausencia de DB-to-DB confirmada en arquitectura/certificación histórica, pendiente de recertificación en vivo al reanudar R2 (foreign servers/extensiones/rutas/DNS). No afirmar aislamiento absoluto solo por el diagrama.

## Veredicto

Plan aprobado conceptualmente con estas precisiones: recuperar R2 detenido de manera conservadora; 33 gated; replay en la capa correcta; cache de autorización prohibida; gateway→DB local explícito; custodia efímera y egress exacto antes de iniciar.
**R4_BLOCKED_PREFLIGHT: R2 detenido y runner híbrido/configuración R4 aún pendientes. STOP.**
