# Team Balancer

Una aplicación web para organizar partidos de fútbol y crear equipos equilibrados basados en las habilidades de los jugadores.

## 🚀 Características

- **Gestión de Partidos**: Crea partidos individuales o recurrentes con fecha, hora y sede
- **Sistema de Votación**: Califica a los jugadores con un sistema de estrellas (1-10)
- **Formación de Equipos**: Algoritmo de balanceo que distribuye jugadores según sus puntuaciones
- **Perfiles de Usuario**: Gestiona tu perfil con foto, información personal y estadísticas
- **Encuestas Post-Partido**: Evalúa la experiencia y selecciona jugadores destacados
- **Historial de Partidos**: Visualiza el historial de partidos jugados con estadísticas
- **Sistema de Jugadores Libres**: Regístrate como disponible para completar equipos
- **Autenticación**: Soporte para usuarios registrados y sesiones de invitados

## 📋 Requisitos

- Node.js 16.x o superior
- NPM 8.x o superior
- Cuenta en Supabase

## 🛠️ Instalación

1. Clona el repositorio:
   ```bash
   git clone https://github.com/tu-usuario/team-balancer.git
   cd team-balancer
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:
   ```
   REACT_APP_SUPABASE_URL=tu_url_de_supabase
   REACT_APP_SUPABASE_ANON_KEY=tu_clave_anonima_de_supabase
   ```

4. Inicia el servidor de desarrollo:
   ```bash
   npm start
   ```

## 📱 Compilación para móvil (Capacitor)

### Android

```bash
npm run build
npx cap sync android
npx cap open android
```

### iOS

```bash
npm run build
npx cap sync ios
npx cap open ios
```

## 🧪 Testing

```bash
npm test
```

## 📚 Estructura del Proyecto

```
src/
├── components/        # Componentes reutilizables
├── context/           # Contextos de React
├── hooks/             # Custom hooks
├── pages/             # Componentes de página completa
├── services/          # Servicios (API, autenticación, etc.)
├── utils/             # Funciones utilitarias
└── constants/         # Constantes y configuración
```

## 🔧 Scripts Disponibles

- `npm start`: Inicia el servidor de desarrollo
- `npm test`: Ejecuta los tests
- `npm run build`: Compila la aplicación para producción
- `npm run eject`: Expone la configuración de webpack (¡operación irreversible!)
- `node scripts/cleanup.js`: Genera un reporte de limpieza de código

## 🗄️ Estructura de la Base de Datos

### Tablas Principales

- **partidos**: Almacena información de los partidos
- **jugadores**: Información de los jugadores
- **votos**: Registra los votos de los jugadores
- **usuarios**: Perfiles de usuario
- **partidos_frecuentes**: Plantillas de partidos recurrentes
- **post_match_surveys**: Encuestas post-partido
- **amigos**: Sistema de amigos entre usuarios
- **jugadores_sin_partido**: Jugadores disponibles para completar equipos

## 🤝 Contribución

1. Haz un fork del proyecto
2. Crea una rama para tu feature (`git checkout -b feature/amazing-feature`)
3. Haz commit de tus cambios (`git commit -m 'Add some amazing feature'`)
4. Push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## 📞 Contacto

Nombre - [@tu_twitter](https://twitter.com/tu_twitter) - email@example.com

Link del Proyecto: [https://github.com/tu-usuario/team-balancer](https://github.com/tu-usuario/team-balancer)