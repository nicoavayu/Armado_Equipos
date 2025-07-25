-- Tabla de amigos (ya debería existir)
CREATE TABLE IF NOT EXISTS amigos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Tabla de notificaciones (ya debería existir)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_amigos_user_id ON amigos(user_id);
CREATE INDEX IF NOT EXISTS idx_amigos_friend_id ON amigos(friend_id);
CREATE INDEX IF NOT EXISTS idx_amigos_status ON amigos(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at en la tabla amigos
DROP TRIGGER IF EXISTS update_amigos_updated_at ON amigos;
CREATE TRIGGER update_amigos_updated_at
    BEFORE UPDATE ON amigos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) policies para amigos
ALTER TABLE amigos ENABLE ROW LEVEL SECURITY;

-- Policy para que los usuarios puedan ver sus propias relaciones de amistad
CREATE POLICY "Users can view their own friendships" ON amigos
  FOR SELECT USING (user_id = auth.uid() OR friend_id = auth.uid());

-- Policy para que los usuarios puedan crear solicitudes de amistad
CREATE POLICY "Users can create friend requests" ON amigos
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Policy para que los usuarios puedan actualizar solicitudes dirigidas a ellos
CREATE POLICY "Users can update friend requests directed to them" ON amigos
  FOR UPDATE USING (friend_id = auth.uid());

-- Policy para que los usuarios puedan eliminar sus propias relaciones de amistad
CREATE POLICY "Users can delete their own friendships" ON amigos
  FOR DELETE USING (user_id = auth.uid() OR friend_id = auth.uid());

-- RLS policies para notificaciones
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policy para que los usuarios solo vean sus propias notificaciones
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- Policy para que se puedan crear notificaciones para cualquier usuario (para el sistema)
CREATE POLICY "System can create notifications" ON notifications
  FOR INSERT WITH CHECK (true);

-- Policy para que los usuarios puedan actualizar sus propias notificaciones (marcar como leídas)
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Policy para que los usuarios puedan eliminar sus propias notificaciones
CREATE POLICY "Users can delete their own notifications" ON notifications
  FOR DELETE USING (user_id = auth.uid());