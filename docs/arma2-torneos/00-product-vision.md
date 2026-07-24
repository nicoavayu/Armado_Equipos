# Arma2 Torneos — visión de producto

Estado: blueprint inicial  
Fecha: 2026-07-24  
Rama base: `epic/arma2-torneos`

## Propósito

Arma2 Torneos será la infraestructura profesional del fútbol amateur: una experiencia mobile-first para crear, operar, comunicar y publicar competencias completas, con una presentación web responsive para tareas de alta densidad.

No es una pestaña de Arma2 personal. Es otro espacio dentro de la misma identidad: comparte cuenta, autenticación y servicios compatibles, pero cambia el shell, la navegación, el contexto operativo y los permisos.

## Usuarios principales

- Organizador institucional que sólo necesita administrar competencias.
- Administrador de una o varias organizaciones.
- Operador de fixture, partidos, disciplina o contenidos.
- Árbitro o colaborador con permisos acotados.
- Capitán que inscribe un equipo y administra un plantel.
- Jugador Arma2 vinculado o jugador provisional.
- Público que consulta fixture, resultados, tablas y contenidos.

Ninguno de estos usuarios debe estar obligado a completar un perfil futbolístico personal para realizar tareas administrativas.

## Principios

1. **Una identidad, espacios separados.** La sesión es común; la autorización y la interfaz dependen del workspace activo.
2. **Organización como workspace.** El espacio principal representa una organización. La temporada, torneo y categoría se seleccionan dentro de ella.
3. **Mobile-first, no mobile-only.** Las operaciones críticas deben poder completarse con una mano y conectividad imperfecta; la web optimiza volumen y edición masiva.
4. **Servidor autoritativo.** El workspace persistido en el cliente es una preferencia, nunca una autorización.
5. **Auditoría por defecto.** Fixture, resultados, sanciones, permisos y publicaciones sensibles dejan trazabilidad.
6. **Integración explícita.** Equipos, perfiles y estadísticas existentes se reutilizan sólo cuando sus conceptos y reglas son compatibles.
7. **Evolución por fases.** No se crean tablas o abstracciones definitivas antes de validar el modelo y los flujos.
8. **Producción apagada.** El producto permanece aislado por ramas, entorno y flags hasta una autorización expresa.

## Límites de la primera fase

Esta fase entrega blueprint, shell responsive, rutas privadas no productivas, flags desactivadas, contexto preliminar y pruebas de aislamiento. No entrega organizaciones persistidas, fixture, tablas, resultados, migraciones, políticas RLS, push, contenido social real, dominios ni despliegue.

## Métrica de éxito del lanzamiento futuro

Una organización ficticia debe poder completar un torneo de punta a punta —configuración, inscripción, fixture, operación, estadísticas, disciplina, comunicación, cierre e historial— sin afectar Arma2 personal, sin accesos indebidos y con recuperación verificable ante errores.

