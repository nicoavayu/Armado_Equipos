# Sistema de Notificaciones In-App

Este documento describe el sistema de notificaciones in-app implementado en Team Balancer.

## Tipos de Notificaciones

El sistema soporta varios tipos de notificaciones:

1. **call_to_vote**: Notificación para llamar a los jugadores a votar
2. **post_match_survey**: Notificación para completar la encuesta post-partido
3. **match_invite**: Invitación a un partido
4. **friend_request**: Solicitud de amistad
5. **match_update**: Actualización de un partido (equipos formados, etc.)

## Flujo de Notificaciones

### Llamado a Votar

Cuando el administrador del partido hace clic en "LLAMAR A VOTAR":

1. Se ejecuta la función `handleCallToVote()` en `AdminPanel.js`
2. Esta función llama a `createCallToVoteNotifications()` de `matchNotifications.js`
3. Se crean notificaciones para todos los jugadores del partido
4. Los jugadores reciben una notificación in-app con un enlace al partido

### Encuesta Post-Partido

Las notificaciones de encuesta post-partido se programan automáticamente:

1. Al cerrar la votación en `handleCerrarVotacion()` de `AdminPanel.js`
2. Se llama a `schedulePostMatchSurveyNotifications()` de `matchNotifications.js`
3. Se actualiza el partido con `hora_fin` y `survey_time` (1 hora después de finalizado)
4. El servicio `checkMatchesForSurveys()` verifica periódicamente los partidos que necesitan encuestas
5. Cuando llega la hora programada, se crean notificaciones para todos los jugadores

## Componentes Principales

- **NotificationContext.js**: Contexto global para manejar notificaciones
- **NotificationsView.js**: Componente para mostrar las notificaciones
- **matchNotifications.js**: Utilidades para crear notificaciones específicas de partidos
- **surveyScheduler.js**: Servicio para programar y enviar notificaciones de encuesta
- **surveyService.js**: Servicio para manejar encuestas post-partido

## Estructura de Datos

Las notificaciones tienen la siguiente estructura:

```javascript
{
  id: "uuid", // Generado por Supabase
  user_id: "uuid", // ID del usuario destinatario
  type: "call_to_vote", // Tipo de notificación
  title: "¡Hora de votar!", // Título de la notificación
  message: "Ya podés calificar a los jugadores del partido.", // Mensaje
  data: { // Datos adicionales específicos del tipo
    matchId: 123,
    matchCode: "abc123",
    matchDate: "2023-05-15",
    matchTime: "19:00",
    matchVenue: "Cancha Principal"
  },
  read: false, // Indica si la notificación fue leída
  created_at: "2023-05-15T19:00:00Z" // Fecha de creación
}
```

## Integración con Push Notifications

El sistema está diseñado para facilitar la futura integración con notificaciones push:

1. Las notificaciones se almacenan en la base de datos
2. El sistema de suscripción en tiempo real de Supabase permite recibir notificaciones instantáneas
3. Para implementar push notifications, se necesitaría:
   - Registrar tokens de dispositivo en la tabla de usuarios
   - Integrar un servicio como Firebase Cloud Messaging o OneSignal
   - Enviar las notificaciones push al crear las notificaciones in-app

## Consideraciones Futuras

- Implementar agrupación de notificaciones similares
- Añadir soporte para notificaciones con acciones personalizadas
- Mejorar el sistema de programación para manejar zonas horarias
- Implementar un sistema de preferencias de notificaciones por usuario