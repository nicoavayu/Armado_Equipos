# Definición de terminado para lanzamiento

Una pantalla funcional o un torneo parcialmente operable no habilitan lanzamiento.

## Ciclo funcional completo

- crear organización y asignar responsables;
- crear temporada, torneo y categorías;
- configurar formato, desempates y disciplina;
- inscribir equipos y aprobar rosters;
- generar/editar fixture y programar canchas/árbitros;
- operar partidos, confirmar/reclamar resultados y eventos;
- recalcular tabla/estadísticas sin estados parciales;
- sugerir, revisar, cumplir y apelar sanciones;
- comunicar y publicar información;
- generar piezas y documentos;
- finalizar, archivar y consultar historial;
- integrar identidades/equipos/estadísticas con Arma2;
- volver a Arma2 personal sin estado residual.

## Seguridad

- auditoría independiente de RLS, RPC/API y Storage;
- tests cross-tenant y permisos revocados;
- secretos y entornos separados;
- privacidad por campo validada;
- revisión específica de menores;
- QR/tokens con scope, expiración y revocación;
- audit log y retención aprobados;
- cero vulnerabilidades críticas conocidas.

## Calidad y operación

- suite unit/integración/E2E estable;
- regresión completa Arma2;
- lint, build y typecheck aplicable;
- iPhone y Android físicos;
- web móvil y escritorio;
- accesibilidad WCAG AA en flujos críticos;
- torneo ficticio completo de punta a punta;
- carga con volumen objetivo;
- conectividad deficiente y reintentos;
- observabilidad, alertas y runbooks;
- soporte y documentación operativa.

## Release

- flags y segmentación listas;
- migraciones revisadas, ensayadas y con rollback;
- backups/restores comprobados;
- staging equivalente sin datos reales;
- plan de rollout gradual;
- plan de rollback técnico y comunicacional;
- aprobación explícita de producto, seguridad y operación;
- stores, dominios y comunicación pública autorizados.

## Condiciones de bloqueo

No lanzar con:

- problemas críticos/altos abiertos;
- permisos basados sólo en UI;
- tablas cliente sin RLS;
- estadísticas o sanciones inconsistentes;
- migraciones no ensayadas;
- notificaciones capaces de alcanzar usuarios reales desde staging;
- datos sensibles visibles o exportables sin justificación;
- tests deshabilitados para pasar el gate;
- dependencia de correcciones manuales no auditadas.

## Estado del núcleo competitivo

No cumple la definición de lanzamiento y no pretende hacerlo. Ya existen
workspaces, configuración, equipos, rosters, fixture y una primera operación
oficial versionada. Ya existe una primera proyección versionada de tabla,
estadísticas y disciplina, pero faltan staging real, mejores terceros/series
configurables, tribunal/apelaciones, publicación pública, notificaciones e
integración oficial con el historial Arma2. La operación no completa el ciclo
de lanzamiento. Las flags siguen apagadas en producción y esta rama sólo puede
integrarse en `epic/arma2-torneos`.

El Participant Hub autenticado completa una primera lectura útil para jugadores
y capitanes, pero tampoco cambia ese estado: faltan validación multirol en
staging, performance con volumen real, accesibilidad manual, dispositivos
físicos, soporte operativo y rollout autorizado. Producción continúa con flags
apagadas.
