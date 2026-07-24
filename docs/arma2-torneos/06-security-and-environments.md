# Seguridad y entornos

## Modelo de entornos

| Recurso | Local | Staging Torneos | Producción Arma2 |
|---|---|---|---|
| Código | feature worktree | epic/preview | `main`/release |
| Supabase | local o proyecto dev | proyecto exclusivo | proyecto actual |
| Storage | local/dev | buckets exclusivos | actual |
| Usuarios | ficticios | ficticios | reales |
| Push | stub/dry run | credenciales sandbox | actual, sin eventos Torneos |
| Analytics | desactivado | proyecto/dataset test | actual, sin eventos Torneos |
| Dominio | localhost | preview privado | sin ruta pública |
| Flags Torneos | opt-in | opt-in | forzadas off |

Esta foundation no se conecta ni despliega a un entorno de Torneos. Crear el proyecto staging y sus secretos es un prerrequisito de la fase de organizaciones.

## Variables

`REACT_APP_DEPLOY_ENV` identifica `development`, `test`, `preview`, `staging` o `production`. Las flags requieren `true` literal y un entorno no productivo. Si el build es production y no hay entorno explícito, se asume producción.

Nunca se versionan URLs, anon keys, service role keys ni secretos reales. La anon key tampoco sustituye autorización.

## Defensa por capas

- Route gate para no montar la interfaz deshabilitada.
- Autenticación común.
- Resolución de membership y capacidades.
- RLS por operación.
- RPC/API para invariantes multi-entidad.
- políticas de Storage.
- auditoría y observabilidad sin PII innecesaria.
- flags como control de release, no de seguridad.

## RLS propuesta

Cada tabla cliente comienza con RLS habilitada y sin políticas permisivas. Se agregan políticas por acción. Las consultas públicas usan vistas/RPCs de proyección con campos allowlisted; nunca exponen la fila administrativa completa.

Los helpers de autorización deben ser estables, testeables y evitar recursión de RLS. Se evalúa una tabla de grants normalizada y funciones `STABLE` con permisos mínimos.

## `SECURITY DEFINER`

Checklist obligatorio:

- necesidad documentada;
- `auth.uid()` no nulo;
- pertenencia y capacidad verificadas;
- IDs resueltos en servidor;
- `SET search_path` fijo;
- SQL dinámico evitado o parametrizado;
- ownership/grants mínimos;
- respuesta sin datos sensibles;
- pruebas positivas, negativas y cross-tenant;
- auditoría dentro de la misma transacción.

## Storage

Buckets separados por propósito: branding público, rosters privados, evidencia disciplinaria privada, contenido generado y exportaciones temporales. Los paths incluyen IDs internos, no slugs confiados. Descargas sensibles usan URLs firmadas breves.

## Datos sensibles y menores

Documentos, contactos, nacimiento y evidencia se separan de proyecciones públicas. Se define propósito, base legal, consentimiento, retención, acceso y borrado antes de almacenar. Torneos de menores quedan fuera del lanzamiento hasta una revisión específica.

## Push y deep links

No se crean eventos Torneos en esta fase. Staging usará tokens de prueba y provider sandbox/dry-run. Un deep link nunca concede permisos y no incluirá secretos permanentes.

## Procedimientos operativos

- No ejecutar `supabase db push` desde este worktree.
- No enlazar el CLI al proyecto productivo.
- No copiar dumps productivos.
- No usar service role en el cliente.
- No activar workflows programados.
- Revisar logs para excluir tokens, documentos y contenido de evidencia.
- Rotar secretos si un preview deja de ser controlado.

## Amenazas prioritarias

| Amenaza | Control |
|---|---|
| Cross-tenant por ID/slug | RLS + membership + tests entre organizaciones |
| Workspace local falsificado | servidor autoritativo |
| Escalada por nombre de rol | capacidades normalizadas |
| Enlace/QR reutilizado | token hash, scope, expiración y revocación |
| Edición parcial de resultado | RPC transaccional e idempotency key |
| Fuga en exportación | snapshot allowlisted, autorización al crear y descargar |
| Evidencia pública accidental | bucket privado y proyección separada |
| Notificación a usuario real | proyecto/credenciales sandbox y flags |
