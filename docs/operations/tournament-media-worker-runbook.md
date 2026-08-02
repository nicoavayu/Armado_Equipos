# Runbook del worker externo Multimedia

El directorio `workers/tournament-media-processor` describe un worker de imágenes separado del orquestador Edge. No se despliega desde este repositorio ni desde CI.

## Provisión

- Host/container Node 22 exacto; sharp 0.33.5 y libvips reportado por self-test.
- ClamAV/clamd/freshclam activos; TCP interno `clamd:3310`; firmas menores a siete días.
- Egress sólo hacia la API de Staging autorizada; ninguna ruta a Production.
- CPU 1, memoria 1 GiB, pids 128, filesystem read-only y `/tmp` 256 MiB.
- Máximo 12 MiB, 36 millones de píxeles y 20 segundos de codec.
- Lease 300 s, máximo tres intentos en DB, batch 1 y backoff exponencial acotado con jitter.
- Variables desde `.env.example`; secretos desde el secret store, nunca en imagen o Compose versionado.
- Logs JSON sin object names, tokens, claves, paths, URLs firmadas o identidad.

Checklist:

1. Construir imagen con lockfile y registrar digest/SBOM.
2. Ejecutar tests unitarios y self-test real.
3. Confirmar `freshclam`, fecha y timezone.
4. Probar EICAR, MIME falso, SVG, metadata, orientación, pixel bomb y timeout.
5. Probar upload/download/delete del objeto sintético y ausencia posterior.
6. Verificar healthcheck verde sin crear atestación.
7. Desplegar con flag Multimedia false.
8. Atestiguar processor con TTL 900 s sólo después del self-test.

## Actualización de firmas

`freshclam` debe renovar sin reiniciar el worker. Alertar a cinco días; a siete días el self-test falla, se revoca la atestación y `uploadReady` se cierra. No cambiar la fecha reportada ni extender el umbral para recuperar servicio.

## Apagado y rollback

1. Detener nuevos leases.
2. Esperar el job actual dentro del grace period mayor al lease.
3. Revocar atestación processor.
4. Confirmar cero leases del worker; los expirados vuelven por sweeper.
5. Conservar logs, jobs, quarantine y objetos para auditoría.
6. Volver al digest anterior registrado y repetir self-test.

SIGTERM/SIGINT activan shutdown seguro: el loop deja de pedir trabajo, termina lo ya arrendado, intenta revocar y sale. Nunca matar durante publicación salvo contención de seguridad.

## Incidentes

- **clamd caído o firmas viejas:** revocar, Multimedia false, restaurar scanner, self-test y re-atestación.
- **libvips/sharp diferente:** retirar release; no procesar. Reconstruir desde lockfile/base pinneada.
- **worker caído:** dejar expirar leases, ejecutar sweeper, revisar idempotencia y reintentos antes de reemplazar.
- **quarantine crece:** flags false, detener sesiones, medir jobs/edad, no borrar hasta correlacionar auditoría.
- **posible malware publicado:** revocar, flags false, retirar publicación mediante flujo de negocio, preservar original/quarantine bajo control de incidente.
- **credencial sospechada:** revocar en Staging, no imprimirla, reemplazar desde secret store y repetir fingerprint/self-test.
- **red apunta a host desconocido/Production:** apagado inmediato; no aceptar override.

Restaurar servicio sólo con plan nuevo, checksums sin drift, firmas vigentes, self-test completo, prueba de revocación y aprobación humana.
