-- Migración para agregar campos necesarios para el sistema de notificaciones

-- Agregar campo para hora de finalización del partido
ALTER TABLE partidos
ADD COLUMN IF NOT EXISTS hora_fin TIMESTAMP WITH TIME ZONE;

-- Agregar campo para indicar si las encuestas ya fueron enviadas
ALTER TABLE partidos
ADD COLUMN IF NOT EXISTS surveys_sent BOOLEAN DEFAULT FALSE;

-- Agregar campo para indicar si la encuesta está programada
ALTER TABLE partidos
ADD COLUMN IF NOT EXISTS survey_scheduled BOOLEAN DEFAULT FALSE;

-- Agregar campo para la hora programada de la encuesta
ALTER TABLE partidos
ADD COLUMN IF NOT EXISTS survey_time TIMESTAMP WITH TIME ZONE;

-- Asegurarse de que la tabla de notificaciones tenga el campo data como JSONB
ALTER TABLE notifications
ALTER COLUMN data TYPE JSONB USING data::JSONB;

-- Crear índice para mejorar el rendimiento de las consultas de notificaciones
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

-- Comentarios para la documentación
COMMENT ON COLUMN partidos.hora_fin IS 'Hora de finalización del partido, utilizada para programar encuestas post-partido';
COMMENT ON COLUMN partidos.surveys_sent IS 'Indica si ya se enviaron las notificaciones de encuesta post-partido';
COMMENT ON COLUMN partidos.survey_scheduled IS 'Indica si la encuesta post-partido está programada';
COMMENT ON COLUMN partidos.survey_time IS 'Hora programada para enviar las notificaciones de encuesta post-partido';