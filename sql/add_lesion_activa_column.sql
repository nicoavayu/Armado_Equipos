-- Agregar columna lesion_activa a la tabla usuarios
ALTER TABLE usuarios 
ADD COLUMN lesion_activa BOOLEAN DEFAULT FALSE;

-- Actualizar usuarios que tienen lesiones activas (sin fecha_fin)
UPDATE usuarios 
SET lesion_activa = TRUE 
WHERE id::text IN (
  SELECT DISTINCT usuario_id::text 
  FROM lesiones 
  WHERE fecha_fin IS NULL
);

-- Política RLS para permitir actualizaciones
CREATE POLICY "Users can update their own lesion status" ON usuarios
FOR UPDATE USING (auth.uid()::text = id::text);

-- Comentario: Esta columna indica si el usuario tiene una lesión activa
COMMENT ON COLUMN usuarios.lesion_activa IS 'Indica si el usuario tiene una lesión activa (sin fecha de fin)';