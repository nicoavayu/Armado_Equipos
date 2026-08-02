# Rollbacks conservadores de Arma2 Torneos

Estos archivos son contención operativa versionada, no migraciones `down` destructivas. Se ejecutan en orden inverso y sólo después de apagar flags, revocar atestaciones y drenar trabajo. Preservan tablas, filas, objetos de Storage y auditoría.

Precondiciones comunes:

1. Plan aprobado ligado al SHA exacto del repositorio y al project ref autorizado.
2. Flags Multimedia y Social en `false` y comprobadas desde una sesión nueva.
3. Signer y processor sin emitir nuevas operaciones; worker sin tomar leases.
4. Backup/PITR y export de auditoría confirmados por un operador.
5. Cero sesiones/leases activos según las consultas fail-closed del propio script.
6. Segunda autorización fuera de este flujo para cualquier `DROP`, `TRUNCATE`, borrado de filas de usuario u objetos del bucket.

Variantes:

- **Contención inmediata:** ejecutar solamente el rollback de la funcionalidad afectada; revoca entradas y conserva datos.
- **Restauración de release:** después de contener y auditar, volver a desplegar el release Edge/worker anterior registrado en el plan.
- **Restauración de contrato SQL anterior:** requiere una migración forward nueva, revisada a partir del estado real. No se reejecuta a ciegas una migración histórica sobre datos nuevos.

Validación posterior: `uploadReady=false`, flags apagadas, atestaciones ausentes, cero leases activos, RPCs de escritura rechazadas, bucket privado y datos/auditoría aún presentes.
