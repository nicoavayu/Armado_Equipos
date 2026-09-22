# FRONTEND-ENV-MATRIX — B04

> **Estado 2026-09-21:** documento de la foundation (pre-R4). La integración B04 está implementada y verificada; la referencia vigente es [B04-FRONTEND-INTEGRATION-REPORT.md](B04-FRONTEND-INTEGRATION-REPORT.md). Lo que abajo dice «futuro», «reservado» o «desactivado» ya no aplica.

No se cargaron `.env` locales ni credenciales. El ejemplo tiene valores vacíos.

| Nombre | Dueño | Estado B04 |
| --- | --- | --- |
| `REACT_APP_SUPABASE_URL` | Core | Nombre consumido por el singleton y guards legacy actuales. |
| `REACT_APP_SUPABASE_ANON_KEY` | Core | Clave pública del cliente actual. |
| `REACT_APP_CORE_SUPABASE_URL` | Core | Alias reservado, validado en resolver puro; no cambia el singleton. |
| `REACT_APP_CORE_SUPABASE_ANON_KEY` | Core | Alias reservado, requiere el par completo. |
| `REACT_APP_TORNEOS_GATEWAY_URL` | Torneos | **Único destino Torneos** (exchange + RPC + tablas del contrato). https (http sólo loopback); nunca el origen Core ni el ref Production. Presente → composición híbrida. |
| `REACT_APP_TORNEOS_API_URL` | Torneos | **Retirada** en la integración: el contrato certificado sirve las tablas por el mismo gateway. |

No hay env de habilitación B04. `enabled` siempre es `false`. No hay env de credenciales privilegiadas ni segunda clave de auth.

Para conservar comportamiento, la app continúa usando el par legacy. Los aliases explícitos pueden prepararse con valores iguales al par legacy; usar **sólo** los aliases todavía no satisface `scripts/validate-build-env.mjs` ni los lectores legacy. Su adopción efectiva exige migrar juntos singleton, build validation, guards de entorno y lectores directos; no se implementa parcialmente.

El resolver rechaza pares explícitos incompletos, valores Core contradictorios, URLs Torneos sin HTTPS, userinfo, query/hash y el mismo origen que Core. Es una validación conservadora de configuración reservada; no certifica DNS, allowlist de despliegue ni topología de gateway. Tampoco habilita loopback ni extiende los permisos del laboratorio previo.

Los targets reales y cualquier adaptación a la topología certificada se revisan después de R2/R3/R4. Ningún ref remoto figura en el nuevo código/config frontend.
