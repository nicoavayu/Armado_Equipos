-- Crear tabla para partidos manuales
CREATE TABLE IF NOT EXISTS partidos_manuales (
    id BIGSERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo_partido VARCHAR(20) NOT NULL CHECK (tipo_partido IN ('amistoso', 'torneo')),
    resultado VARCHAR(20) NOT NULL CHECK (resultado IN ('ganaste', 'perdiste', 'empate')),
    fecha DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear tabla para lesiones
CREATE TABLE IF NOT EXISTS lesiones (
    id BIGSERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo_lesion VARCHAR(100) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_partidos_manuales_usuario_id ON partidos_manuales(usuario_id);
CREATE INDEX IF NOT EXISTS idx_partidos_manuales_fecha ON partidos_manuales(fecha);
CREATE INDEX IF NOT EXISTS idx_lesiones_usuario_id ON lesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_lesiones_fecha_inicio ON lesiones(fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_lesiones_activas ON lesiones(usuario_id, fecha_fin) WHERE fecha_fin IS NULL;

-- Políticas RLS para partidos_manuales
ALTER TABLE partidos_manuales ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver y modificar sus propios partidos manuales
CREATE POLICY "Users can view own manual matches" ON partidos_manuales
    FOR SELECT USING (auth.uid() = usuario_id);

CREATE POLICY "Users can insert own manual matches" ON partidos_manuales
    FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Users can update own manual matches" ON partidos_manuales
    FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "Users can delete own manual matches" ON partidos_manuales
    FOR DELETE USING (auth.uid() = usuario_id);

-- Políticas RLS para lesiones
ALTER TABLE lesiones ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver y modificar sus propias lesiones
CREATE POLICY "Users can view own injuries" ON lesiones
    FOR SELECT USING (auth.uid() = usuario_id);

CREATE POLICY "Users can insert own injuries" ON lesiones
    FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Users can update own injuries" ON lesiones
    FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "Users can delete own injuries" ON lesiones
    FOR DELETE USING (auth.uid() = usuario_id);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para actualizar updated_at
CREATE TRIGGER update_partidos_manuales_updated_at 
    BEFORE UPDATE ON partidos_manuales 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lesiones_updated_at 
    BEFORE UPDATE ON lesiones 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();