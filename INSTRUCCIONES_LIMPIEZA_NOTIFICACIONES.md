# INSTRUCCIONES: Limpieza y Prevención de Notificaciones Duplicadas

## ⚠️ ADVERTENCIAS CRÍTICAS

1. **EJECUTAR EN STAGING PRIMERO** - Validar todos los resultados antes de producción
2. **BACKUP OBLIGATORIO** - No ejecutar en producción sin backup completo
3. **ORDEN ESTRICTO** - Ejecutar los pasos en el orden indicado (1→9)
4. **VALIDACIÓN** - Reportar outputs de cada paso antes de continuar

---

## 🎯 Objetivo

- Normalizar notificaciones con columna `partido_id` canonical y `data.match_id` (string)
- Eliminar duplicados: 1 notificación por `(user_id, partido_id, type)`
- Conservar notificaciones no-leídas; si todas leídas, conservar la más reciente
- Crear índices únicos para prevenir re-duplicación
- Programar cron DB para fanout canonical

---

## 📋 PASOS DE EJECUCIÓN

### **PASO 1: Verificar Esquema Actual**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notifications'
ORDER BY ordinal_position;
```

**Acción**: Confirmar que existe la tabla y reportar columnas actuales.

---

### **PASO 2: Crear Columna Canonical (si falta)**

```sql
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS partido_id bigint;
```

**Acción**: Ejecutar y confirmar éxito.

---

### **PASO 3: Backup Completo (OBLIGATORIO)**

```sql
-- Crear tabla de backup
CREATE TABLE IF NOT EXISTS public.notifications_backup AS 
TABLE public.notifications WITH NO DATA;

-- Copiar todos los datos
INSERT INTO public.notifications_backup 
SELECT * FROM public.notifications;

-- Verificar backup
SELECT 
  (SELECT COUNT(*) FROM public.notifications) AS original_count,
  (SELECT COUNT(*) FROM public.notifications_backup) AS backup_count;
```

**Acción**: Confirmar que `original_count = backup_count` antes de continuar.

---

### **PASO 4: Backfill de partido_id y data.match_id**

```sql
-- Backfill partido_id desde data.matchId
UPDATE public.notifications
SET partido_id = (data->>'matchId')::bigint
WHERE partido_id IS NULL 
  AND (data->>'matchId') ~ '^[0-9]+$';

-- Backfill partido_id desde data.match_id
UPDATE public.notifications
SET partido_id = (data->>'match_id')::bigint
WHERE partido_id IS NULL 
  AND (data->>'match_id') ~ '^[0-9]+$';

-- Backfill partido_id desde data.match_id_text
UPDATE public.notifications
SET partido_id = (data->>'match_id_text')::bigint
WHERE partido_id IS NULL 
  AND (data->>'match_id_text') ~ '^[0-9]+$';

-- Asegurar data.match_id (string) cuando partido_id existe
UPDATE public.notifications
SET data = jsonb_set(
  data, 
  '{match_id}', 
  to_jsonb(COALESCE(
    data->>'match_id', 
    data->>'matchId', 
    (partido_id)::text
  )), 
  true
)
WHERE (data->>'match_id') IS NULL 
  AND partido_id IS NOT NULL;
```

**Acción**: Ejecutar y reportar cuántas filas fueron actualizadas en cada UPDATE.

---

### **PASO 5: (OPCIONAL) Marcar Notificaciones Problemáticas como Leídas**

Si necesitas ocultar notificaciones duplicadas de un usuario específico antes del dedupe:

```sql
-- Reemplazar <USER_ID> y <PARTIDO_ID> con valores reales
UPDATE public.notifications
SET read = true, read_at = now()
WHERE (
    partido_id = <PARTIDO_ID> 
    OR data->>'match_id' = '<PARTIDO_ID>' 
    OR data->>'matchId' = '<PARTIDO_ID>'
  )
  AND user_id = '<USER_ID>'
  AND type IN ('survey_start', 'post_match_survey', 'survey_results_ready');
```

**Acción**: Solo ejecutar si es necesario. Reportar cuántas filas fueron actualizadas.

---

### **PASO 6: Deduplicación Conservadora con Auditoría**

```sql
BEGIN;

-- Crear tabla de auditoría para duplicados
CREATE TABLE IF NOT EXISTS public.notifications_duplicates AS 
TABLE public.notifications WITH NO DATA;

-- Copiar duplicados que vamos a borrar (rn > 1)
WITH ranked_copy AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        user_id,
        COALESCE(
          partido_id, 
          CASE WHEN (data->>'match_id') ~ '^[0-9]+$' 
               THEN (data->>'match_id')::bigint 
               ELSE NULL 
          END
        ),
        type
      ORDER BY 
        (CASE WHEN COALESCE(read, false) = false THEN 1 ELSE 0 END) DESC,
        created_at DESC
    ) AS rn
  FROM public.notifications
  WHERE type IN ('survey_start', 'post_match_survey')
)
INSERT INTO public.notifications_duplicates
SELECT n.*
FROM public.notifications n
JOIN ranked_copy r ON n.id = r.id
WHERE r.rn > 1;

-- Reportar cuántos duplicados se van a borrar
SELECT COUNT(*) AS duplicates_to_delete 
FROM public.notifications_duplicates;

-- Borrar duplicados (mantener rn = 1)
WITH ranked_del AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY 
        user_id,
        COALESCE(
          partido_id, 
          CASE WHEN (data->>'match_id') ~ '^[0-9]+$' 
               THEN (data->>'match_id')::bigint 
               ELSE NULL 
          END
        ),
        type
      ORDER BY 
        (CASE WHEN COALESCE(read, false) = false THEN 1 ELSE 0 END) DESC,
        created_at DESC
    ) AS rn
  FROM public.notifications
  WHERE type IN ('survey_start', 'post_match_survey')
)
DELETE FROM public.notifications n
USING ranked_del r
WHERE n.id = r.id AND r.rn > 1;

COMMIT;
```

**Acción**: Reportar `duplicates_to_delete` antes de confirmar el DELETE.

---

### **PASO 7: Crear Índices Únicos**

```sql
-- Índice único cuando partido_id está presente
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_user_partido_type
  ON public.notifications (user_id, partido_id, type)
  WHERE partido_id IS NOT NULL;

-- Índice expresivo para data.match_id numérico (cuando no hay partido_id)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_user_matchid_type_expr
  ON public.notifications (user_id, ((data->>'match_id')::bigint), type)
  WHERE (data->>'match_id') ~ '^[0-9]+$';
```

**Acción**: Ejecutar y confirmar que los índices se crearon exitosamente.

---

### **PASO 8: Verificación Final**

```sql
-- Buscar duplicados restantes
SELECT 
  user_id, 
  COALESCE(partido_id::text, data->>'match_id') AS match_id_text, 
  type, 
  COUNT(*) AS cnt
FROM public.notifications
WHERE type IN ('survey_start', 'post_match_survey')
GROUP BY user_id, COALESCE(partido_id::text, data->>'match_id'), type
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

**Resultado Esperado**: 0 filas (sin duplicados).

**Acción**: Reportar resultado. Si hay filas, investigar antes de continuar.

---

### **PASO 9: Programar Job de Fanout (Recomendado)**

#### Opción A: Supabase Scheduled SQL
En el dashboard de Supabase:
1. Ir a **SQL Editor** → **Scheduled Jobs**
2. Crear nuevo job con frecuencia: `* * * * *` (cada minuto)
3. SQL:
```sql
CALL public.fanout_survey_start_notifications();
```

#### Opción B: pg_cron
```sql
SELECT cron.schedule(
  'fanout_survey_start_notifications_every_min', 
  '* * * * *', 
  $$CALL public.fanout_survey_start_notifications();$$
);
```

**Acción**: Confirmar que el job está programado y ejecutándose.

---

## 🔄 Rollback / Recuperación

### Si algo sale mal:

```sql
-- Restaurar desde backup completo
BEGIN;
TRUNCATE public.notifications;
INSERT INTO public.notifications SELECT * FROM public.notifications_backup;
COMMIT;
```

### Revisar duplicados borrados:

```sql
SELECT * FROM public.notifications_duplicates
ORDER BY created_at DESC
LIMIT 100;
```

---

## 📊 Reportes Requeridos

Después de ejecutar, reportar:

1. **Paso 1**: Lista de columnas actuales
2. **Paso 3**: Confirmación de counts (original = backup)
3. **Paso 4**: Número de filas actualizadas en cada UPDATE
4. **Paso 6**: Número de duplicados copiados y borrados
5. **Paso 8**: Resultado de verificación final (debe ser 0 filas)

---

## ⚙️ Notas Técnicas

### Criterio de Preferencia
- **Prioridad 1**: Notificaciones no-leídas (`read = false`)
- **Prioridad 2**: Notificaciones más recientes (`created_at DESC`)

### Tipos de Notificación Afectados
- `survey_start`
- `post_match_survey`

### Agrupación de Duplicados
Por: `(user_id, partido_id o match_id numérico, type)`

### Limitaciones
- Solo procesa `data.match_id` numéricos en índice expresivo
- Notificaciones con `match_id` no-numérico quedan fuera del índice único
- Revisar manualmente si existen formatos no-estándar

---

## ✅ Checklist de Ejecución

- [ ] Confirmar entorno: STAGING
- [ ] Paso 1: Esquema verificado
- [ ] Paso 2: Columna partido_id creada
- [ ] Paso 3: Backup completo confirmado
- [ ] Paso 4: Backfill ejecutado y reportado
- [ ] Paso 5: (Opcional) Ejecutado si necesario
- [ ] Paso 6: Duplicados copiados y borrados
- [ ] Paso 7: Índices únicos creados
- [ ] Paso 8: Verificación final = 0 duplicados
- [ ] Paso 9: Job de fanout programado
- [ ] Validar en STAGING por 24-48 horas
- [ ] Repetir en PRODUCCIÓN con backup

---

## 🚨 Condiciones de Parada

**DETENER INMEDIATAMENTE SI:**
- Backup no coincide con original (Paso 3)
- Verificación final muestra duplicados (Paso 8)
- Cualquier error SQL no esperado
- Pérdida de datos detectada

**Reportar error completo antes de continuar.**

---

**Fecha de creación**: $(date)  
**Versión**: 1.0  
**Autor**: Team Balancer - Limpieza de Notificaciones
