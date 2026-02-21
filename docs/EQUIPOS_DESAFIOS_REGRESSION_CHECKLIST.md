# Equipos & Desafios - Regression Checklist

## Feature flag
- [ ] `REACT_APP_ENABLE_EQUIPOS_TAB=false` mantiene Quiero Jugar en modo legacy (sin tab Equipos visible).
- [ ] `REACT_APP_ENABLE_EQUIPOS_TAB=true` muestra tabs `Individual | Equipos`.

## No-regression (flujo existente)
- [ ] Inicio carga sin cambios visuales ni de navegacion.
- [ ] Partido nuevo funciona completo (crear, editar, invitar, admin).
- [ ] Mis partidos abre y permite ver/entrar como antes.
- [ ] Frecuentes lista y detalle sin cambios.
- [ ] Estadisticas carga correctamente.
- [ ] Historial actual sin errores ni cambios de ruta.
- [ ] Amigos: busqueda, solicitudes y aceptacion intactas.
- [ ] Perfil: edicion, avatar y datos intactos.
- [ ] Notificaciones: listado, acciones y redirecciones intactas.
- [ ] Quiero Jugar > `Individual` muestra contenido legacy (partidos/jugadores, toggle disponibilidad, modales actuales).

## Nuevo modulo Equipos & Desafios
- [ ] Quiero Jugar > `Equipos` renderiza sub-tabs `Desafios`, `Mis equipos`, `Mis desafios`.
- [ ] Crear equipo guarda nombre/formato/zona/nivel.
- [ ] Carga de escudo sube archivo a bucket `team-crests` y persiste `crest_url`.
- [ ] Colores opcionales (0..3) se guardan y afectan estilo de TeamCard/ChallengeCard.
- [ ] En `Mis equipos`, agregar/quitar miembros de plantilla funciona.
- [ ] Setear capitan/roles/numero en plantilla funciona.
- [ ] Publicar desafio desde `Desafios` y desde detalle de equipo funciona.
- [ ] Feed `Desafios` aplica filtros por formato/zona/nivel.
- [ ] Aceptar desafio (con equipo de mismo formato) funciona via RPC.
- [ ] Confirmar desafio en `Mis desafios` funciona via RPC.
- [ ] Finalizar desafio (scores + fecha) crea registro oficial y deja estado `completed`.
- [ ] Historial vs rivales en detalle de equipo refleja `team_matches`.
