# Dataset demo de Torneos

Estado: especificado y validable en dry-run. No ejecutado contra Supabase local,
Staging ni Production.

## Propósito

El dataset `torneos-demo-v1` es determinístico: todos los identificadores se
derivan de una clave estable y el plan usa semántica de `upsert` por `id`. Dos
dry-runs producen exactamente el mismo resultado. El script no contiene
contraseñas, tokens, cookies, service-role keys ni SQL.

## Contenido

- Una organización con nombre largo y cuatro torneos en estados `draft`,
  `in_progress`, `completed` y `archived`.
- Ocho equipos, dos sin escudo, con diez jugadores por plantel.
- Perfiles Arma2 y jugadores provisionales; varios jugadores no tienen avatar y
  deben caer en iniciales o avatar genérico.
- Nombres largos de organización, equipo y jugador para probar truncamiento y
  wrapping.
- Siete fechas de liga, cuatro partidos por fecha.
- Dos semifinales y una final.
- Resultado normal, empate, definición por penales, walkover, suspendido,
  postergado y resultado bajo revisión.
- Goles, asistencias, amarilla, roja y sanciones activa/cumplida.
- Una selección de equipo ideal persistida con `selectionMode: manual`, sin
  votos, ponderaciones ni ranking automático.

## Uso seguro

```bash
npm run qa:torneos:seed:dry-run
```

El comando sólo valida y muestra el plan idempotente. `--apply` y `--execute`
fallan intencionalmente en esta entrega. Cualquier target de Supabase remoto no
allowlisteado, el ref configurado de Production o `app.arma2.com.ar` también
provoca un fallo inmediato.

## Fuera de esta etapa

- No se crean tablas, policies, buckets, migraciones, RPCs ni Edge Functions.
- No se carga ningún archivo a Storage.
- No se generan ni publican fotos específicas de jugadores.
- No se ejecuta el seed en un entorno remoto.
