# FRONTEND-AUTH-FLOW — B04

> **Estado 2026-09-21:** documento de la foundation (pre-R4). La integración B04 está implementada y verificada; la referencia vigente es [B04-FRONTEND-INTEGRATION-REPORT.md](B04-FRONTEND-INTEGRATION-REPORT.md). Lo que abajo dice «futuro», «reservado» o «desactivado» ya no aplica.

## Hoy

1. El usuario entra por el login Core existente.
2. `src/lib/supabaseClient.js` conserva `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`, su fetch wrapper y la selección actual de storage key del SDK.
3. `src/lib/coreSupabaseClient.js` reexporta ese mismo objeto. No llama `createClient`, no cambia envs ni mueve la sesión.
4. La foundation Torneos no recibe ni lee tokens, no crea GoTrue y no ofrece `.auth`, `.storage`, `.from`, `.rpc`, `.channel` o `.functions`.
5. Cualquier operación permitida rechaza con `TORNEOS_TRANSPORT_NOT_CONNECTED`; cualquier operación fuera de scope rechaza antes con `TORNEOS_OUTSIDE_STAGING_V1`.

## Integración posterior, sujeta a evidencia R2/R3/R4

Core continuará siendo la única autoridad de login. El punto de composición de la app podrá enlazar el contrato certificado de identidad con el gateway Torneos; los componentes de negocio no recibirán el cliente Core. Shadow identity y acceso a equipos Core pertenecen a los contratos HTTPS del backend, sin DB-to-DB ni FK física.

No se implementa ahora token exchange, cache de bearer, refresh, logout remoto ni persistencia. El adapter posterior debe fallar cerrado ante sesión ausente/vencida, logout, cambio de usuario, errores y timeouts; nunca reenviar una operación Torneos al cliente Core. Su ciclo de vida se verifica con pruebas del contrato certificado antes de conectarlo a UI.

## Laboratorio preexistente

`isolated/createTorneosClient.js` ya usa un cliente con `accessToken`, sin persistencia ni auto-refresh de Torneos, y escucha cambios de sesión Core. Está limitado al loopback previo. Su ruta `/exchange`, TTL y origen son evidencia de ese laboratorio, no contratos de staging híbrido; B04 no lo modifica ni generaliza.

Referencia del SDK consultada sólo como documentación pública: [Supabase JS — Initializing](https://supabase.com/docs/reference/javascript/initializing). No se incorpora ninguna nueva API del SDK ni se consulta un proyecto Supabase.
