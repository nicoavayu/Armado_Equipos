# Navegación y workspaces

## Decisión

El workspace principal representa una **organización**. Una organización puede contener temporadas, torneos y categorías simultáneas. El torneo activo es una selección interna y no un workspace independiente.

Esto evita duplicar membresías al administrar varias competencias y permite roles organizacionales con excepciones por torneo.

## Selector de espacios futuro

El selector de cuenta listará:

- Arma2 personal;
- organizaciones accesibles;
- crear organización;
- unirse a una organización.

Cambiar de espacio reemplaza el shell completo, mantiene la sesión, limpia estado incompatible y valida nuevamente la membresía. El último espacio es una preferencia local versionada. Si fue revocado, se vuelve a Arma2 personal o a otro espacio autorizado.

El selector no se expone en producción durante esta fase.

## Navegación móvil

Barra inferior propia:

1. Inicio
2. Partidos
3. Equipos
4. Tabla
5. Gestión

Inicio concentra alertas operativas y acciones rápidas. Las pantallas de carga priorizan targets táctiles de al menos 44 px, estados de guardado explícitos y flujos de una mano.

## Navegación web

Desde 960 px, la misma arquitectura aparece como sidebar persistente. La cabecera contiene organización, competencia activa, estado del entorno y acciones contextuales. Las operaciones densas pueden usar tablas, drawers y selección masiva sin cambiar reglas.

## Jerarquía prevista

```text
Organización
├── Resumen institucional
├── Temporadas
│   └── Torneos
│       ├── Categorías / fases / grupos
│       ├── Partidos
│       ├── Equipos e inscripciones
│       ├── Tabla y estadísticas
│       ├── Disciplina
│       └── Contenido y publicación
├── Sedes, canchas y árbitros
├── Comunicaciones
├── Administradores y permisos
└── Configuración y exportaciones
```

## Contexto preliminar

La foundation incluye un proveedor local con una organización ficticia. Sirve para validar la separación del shell y la persistencia, no para probar autorización. El shape mínimo contiene:

- `workspace.id`, `name`, `slug`, `role`;
- `season`;
- `tournament`;
- `availableWorkspaces`;
- `selectWorkspace`.

Todo consumidor debe asumir que esta selección puede ser inválida hasta que el servidor la confirme.

## Limpieza de estado al cambiar

La implementación real deberá cancelar solicitudes, desuscribir realtime, vaciar cachés por scope, cerrar modales y navegar al inicio del nuevo workspace. Formularios con cambios sin guardar requieren confirmación antes del cambio.

## Deep links

Un deep link futuro transportará un recurso, no permisos. Secuencia:

1. autenticar si hace falta;
2. resolver organización y recurso;
3. verificar membresía/capacidad en servidor;
4. cambiar workspace;
5. navegar al destino;
6. mostrar un error seguro si no existe o no hay acceso.

