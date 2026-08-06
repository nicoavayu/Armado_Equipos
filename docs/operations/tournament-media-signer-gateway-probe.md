# Probe de la credencial del gateway del signer

**Estado: preparado, NO ejecutado.** Nada en este cambio lo corrió. El comando por defecto no contacta nada.

Entrypoint: `scripts/torneos-staging/signer-gateway-probe.mjs`.

## Qué pregunta y por qué no se puede preguntar de otra forma

El renovador manda tres cabeceras al signer. Cuando falla con 401 hay dos causas posibles y hasta ahora eran indistinguibles desde afuera:

- el gateway de Functions rechazó el bearer, porque la Edge Function está desplegada con `verify_jwt = true` y la credencial no es un JWT;
- el signer aceptó al gateway y rechazó el secreto de atestación (eso es 403, no 401, pero sólo si la request llegó al signer).

No existe endpoint de sólo lectura que responda esa pregunta. El único que contesta es `health`, y `health` no es una consulta: sube un objeto de prueba, lo firma, lo lee, lo borra y **escribe una atestación** de 3600 s vía `attest_tournament_media_service('signer', …)`.

Es decir: "probar la credencial" muta Staging y alimenta `tournament_media_pipeline_readiness()`. Por eso el probe pide autorización explícita en vez de correr solo.

## Autorización

Tres autorizaciones independientes. Falta una y es rechazo con exit 1:

| Autorización | Forma |
|---|---|
| Flag | `--i-authorize-attestation-write` |
| Frase de entorno | `TORNEOS_PROBE_AUTHORIZATION=yes-write-a-signer-attestation-in-staging` |
| Proyecto deletreado | `--project-ref=<ref de Staging autorizado>` |

Ninguna se puede tipear por accidente, y las tres juntas no se producen por un `export` olvidado en un `.envrc`.

## Uso

```bash
node scripts/torneos-staging/signer-gateway-probe.mjs plan
```

`plan` es el default. Corre el preflight local (forma de la credencial, host autorizado, ref de proyecto), imprime la request que haría — método, URL, **nombres** de cabecera, cuerpo — y el plan de rollback completo. `remoteCalls: 0`, `executed: false`.

```bash
node scripts/torneos-staging/signer-gateway-probe.mjs run \
  --i-authorize-attestation-write --project-ref=<ref>
```

Una sola request. Reporta el status, en qué capa se resolvió (`gateway-rejected-bearer` / `signer-rejected-attestation-secret` / `signer-attested`) y si escribió atestación. **No** imprime el cuerpo: la evidencia del signer no va a una terminal.

## Preflight local (sin red)

Antes de cualquier request se decide localmente todo lo decidible:

- la credencial del gateway pasa por `inspectGatewayJwt`: tres segmentos base64url, `alg` presente y distinto de `none`, `role` en `anon`/`authenticated`, `exp` numérico y futuro, `ref` coincidente con el proyecto. Nunca se verifica la firma — el renovador no tiene la clave, y una firma "verificada" localmente sólo probaría que sabemos hacer nuestra propia cuenta.
- una `sb_publishable_…` como bearer se rechaza acá: no es un JWT y `verify_jwt = true` no la acepta. Un probe que va a dar 401 seguro no se corre.
- una `sb_secret_…` o un JWT con `role: service_role` se rechazan siempre.
- el host tiene que ser el de Staging autorizado, y los refs de producción se rechazan sin excepción.

## Interpretación del resultado

| Status | Capa | Qué significa | Escribió |
|---:|---|---|---|
| 200 | `signer-attested` | la credencial sirve **y** hay una atestación nueva de 3600 s | sí |
| 401 | `gateway-rejected-bearer` | el gateway rechazó el bearer; es exactamente lo que este probe existe para distinguir | no |
| 403 | `signer-rejected-attestation-secret` | el gateway aceptó, el signer rechazó el secreto | no |
| 5xx | `other` | el probe de Storage del signer falla; ir al bucket, no a la credencial | no |

Un 200 **no** es luz verde para nada más. La habilitación de Multimedia sigue requiriendo todas las demás compuertas, incluida la observabilidad, que está cerrada.

## Rollback

El probe puede crear exactamente una fila. El plan está también impreso por `plan`, para no tener que buscarlo después del hecho.

**Qué cambia**

- una fila en `public.tournament_media_service_attestations` para `service = 'signer'`, TTL 3600 s, escrita por el signer;
- un objeto transitorio bajo `_probe/` que el signer borra en su propio `finally` dentro de la misma request.

**Qué no cambia**

- ningún flag: `REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED` y `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` siguen en false;
- ninguna migración, Secret, Edge Function ni worker;
- ningún dato de usuario.

**Revocación**

1. Decidir dentro del TTL. **No hacer nada ya es un rollback válido**: la atestación vence a los 3600 s y `uploadReady` se cierra sola.
2. Para cerrar ya: `select public.revoke_tournament_media_service_attestation(p_service := 'signer');` por el flujo aprobado, con la credencial de servicio desde el host de operación autorizado — nunca desde CI, nunca desde un browser.
3. Verificar el cierre leyendo el veredicto, no asumiéndolo: `select public.tournament_media_pipeline_readiness();` debe dar `uploadReady` false con blocker de atestación del signer.
4. Confirmar que no quedó residuo bajo `_probe/` más viejo que el período de gracia. Si quedó, el borrado del signer falló y eso es un incidente propio ([residual-objects](tournament-media-observability.md#residual-objects)).
5. Registrar la corrida: timestamp, operador, ref de proyecto, status resultante y si se revocó o se dejó vencer.

## Relación con el renovador

Este probe y `workers/tournament-media-signer-renewer` hacen la misma request. La diferencia es de propósito y de gobierno: el renovador la hace en un loop autorizado y programado, el probe la hace una vez y a mano, con autorización explícita, para diagnosticar la credencial. Si el probe da 200 y el renovador sigue dando 401, la diferencia está en la credencial que cada uno lee del secret store, no en el signer.
