# Avatar URL Migration Report

## Overview

This report documents the changes made to standardize all profile image handling to use `usuarios.avatar_url` as the single source of truth, removing references to `jugadores.foto_url` and `profiles.avatar_url`.

## Changes Made

### Database Functions (`src/supabase.js`)

- Modified the `uploadFoto` function to update `usuarios.avatar_url` instead of `jugadores.foto_url`
- Updated references in other functions to use `avatar_url` consistently
- Added fallbacks where necessary for backward compatibility

### Components

#### `src/VotingView.js`
- Updated to primarily use `avatar_url` with fallbacks to `foto_url`
- Added warning logs when fallbacks are used:
  ```javascript
  if (player.foto_url && !player.avatar_url) {
    console.warn('VotingView: Using foto_url fallback for player:', player.nombre, '- Consider migrating to avatar_url');
  }
  ```

#### `src/components/PlayerCard.js`
- Added fallback to `foto_url` with warning:
  ```javascript
  const playerPhoto = profile?.avatar_url || profile?.foto_url || user?.user_metadata?.avatar_url;
  
  if (profile?.foto_url && !profile?.avatar_url) {
    console.warn('PlayerCard: Using foto_url fallback for player:', profile?.nombre, '- Consider migrating to avatar_url');
  }
  ```

#### `src/components/TeamDisplay.js`
- Added fallback to `foto_url` with warning:
  ```javascript
  {player.foto_url && !player.avatar_url && 
    console.warn('TeamDisplay: Using foto_url fallback for player:', player.nombre, '- Consider migrating to avatar_url')}
  <img 
    src={player.avatar_url || player.foto_url || 'https://api.dicebear.com/6.x/pixel-art/svg?seed=default'} 
    alt={player.nombre} 
    className="player-avatar" 
  />
  ```

#### `src/components/ProfileCard.js`
- Already correctly using only `avatar_url`:
  ```javascript
  avatarUrl: profile?.avatar_url, // Use only avatar_url
  ```

#### `src/components/AvatarWithProgress.js`
- Already correctly using only `avatar_url`
- Contains comment: "No need for foto_url fallback anymore"

#### `src/components/ProfileMenu.js`
- Already correctly saving to `avatar_url`:
  ```javascript
  await updateProfile(user.id, { avatar_url: fotoUrl });
  ```

#### `src/components/ProfileEditor.js`
- Already correctly using `avatar_url` for both display and updates:
  ```javascript
  // Update profile with avatar_url (for users table)
  await updateProfile(user.id, { avatar_url: fotoUrl });
  ```

## Fallback Strategy

To ensure backward compatibility during the migration period, we've implemented fallbacks in components that display user avatars:

1. First try to use `usuarios.avatar_url` (primary source)
2. If not available, fall back to `jugadores.foto_url` (legacy source)
3. If neither is available, use default avatar

All fallbacks include console warnings to help identify places where data migration is needed.

## Recommended Next Steps

1. **Data Migration**: Run a database update to copy existing `jugadores.foto_url` values to `usuarios.avatar_url` where missing:
   ```sql
   UPDATE usuarios
   SET avatar_url = jugadores.foto_url
   FROM jugadores
   WHERE usuarios.id = jugadores.user_id
     AND jugadores.foto_url IS NOT NULL
     AND usuarios.avatar_url IS NULL;
   ```

2. **Monitoring**: Monitor console warnings in the browser to identify any instances where fallbacks are being used.

3. **Final Cleanup**: After confirming all data has been migrated and no fallbacks are being used, remove the fallback code and warnings.

## Potential Edge Cases

1. **New User Registration**: New users will only have `usuarios.avatar_url` set, with no entry in `jugadores.foto_url`.

2. **Legacy Data**: Some older accounts might still rely on `jugadores.foto_url` until the data migration is complete.

3. **Third-party Integrations**: Any external services or APIs that might be expecting `jugadores.foto_url` should be updated.

## Conclusion

The migration to use `usuarios.avatar_url` as the single source of truth for profile images has been implemented with backward compatibility in mind. The fallback mechanism ensures a smooth transition while the console warnings help identify areas that need data migration.