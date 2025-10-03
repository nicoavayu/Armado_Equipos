# Manual Matches and Injuries Feature

## Overview
This feature adds two new functionalities to the stats view:
1. **Manual Match Registration** - Users can manually add matches they played outside the app
2. **Injury Tracking** - Users can register and track their injuries

## Database Tables

### partidos_manuales
- `id` - Primary key
- `usuario_id` - User ID (foreign key to auth.users)
- `tipo_partido` - Match type: 'amistoso' or 'torneo'
- `resultado` - Result: 'ganaste', 'perdiste', or 'empate'
- `fecha` - Match date
- `created_at` - Creation timestamp
- `updated_at` - Update timestamp

### lesiones
- `id` - Primary key
- `usuario_id` - User ID (foreign key to auth.users)
- `tipo_lesion` - Injury type (text field)
- `fecha_inicio` - Start date (required)
- `fecha_fin` - End date (optional, null if injury is still active)
- `created_at` - Creation timestamp
- `updated_at` - Update timestamp

## Features

### Manual Match Registration
- **Button**: "Sumar Partido Manual" in stats view
- **Form Fields**:
  - Match type: Dropdown (Amistoso/Torneo)
  - Result: Button selection (Ganaste/Empate/Perdiste) with emojis
  - Date: Date picker (defaults to today)
- **Integration**: Manual matches are included in statistics and charts with visual distinction (red bars)

### Injury Tracking
- **Button**: "Registrar Lesión" in stats view
- **Form Fields**:
  - Injury type: Dropdown with common injury types
  - Start date: Date picker (required)
  - End date: Date picker (optional)
- **Status Display**:
  - Active injury: "En recuperación desde [date]" with injury type
  - Past injury: "Última lesión: [days] días atrás" with injury type
- **Visual**: Injury status card with appropriate colors (red for active, green for recovered)

## UI Components

### StatsView.js
- Added action buttons for both features
- Integrated injury status display
- Enhanced chart to show manual matches with different colors
- Added chart legend to distinguish match types

### ManualMatchModal.js
- Form for manual match registration
- Result selection with emoji buttons
- Form validation and error handling

### InjuryModal.js
- Form for injury registration
- Dropdown with common injury types
- Optional end date for ongoing injuries

## Database Setup

Run the SQL script `create_manual_matches_and_injuries_tables.sql` to create the required tables with:
- Proper indexes for performance
- Row Level Security (RLS) policies
- Automatic timestamp updates

## Styling

- Mobile-first responsive design
- Consistent with app's visual theme
- Action buttons with hover effects
- Injury status with color coding
- Chart legend for manual matches

## Security

- RLS policies ensure users can only access their own data
- Proper foreign key constraints
- Input validation on both client and database level