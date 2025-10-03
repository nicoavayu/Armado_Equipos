# Profile Image Standardization Refactoring Report

## Overview

This report documents the refactoring work completed to standardize all profile image handling to use only the `usuarios` table and the `avatar_url` field as the single source of truth for user profile images. The goal was to remove all references to the `profiles` table and the `foto_url` field, ensuring consistent profile image handling across the application.

## Changes Made

### 1. Authentication Flow

The authentication flow was verified to ensure user data is properly saved to the `usuarios` table on login:

- `AuthProvider.js` correctly uses `getProfile` and `createOrUpdateProfile` functions from `supabase.js`
- `getProfile` function in `supabase.js` correctly queries the `usuarios` table
- `createOrUpdateProfile` function in `supabase.js` correctly inserts/updates the `usuarios` table with user data, including `avatar_url`

### 2. Profile Image Upload

The profile image upload functionality was updated to save images to the `usuarios.avatar_url` field:

- `uploadFoto` function in `supabase.js` now correctly updates the `usuarios` table with the `avatar_url` field

### 3. Component Updates

Several components were updated to use only `avatar_url` for profile images:

#### VotingView.js
- Removed fallbacks to `foto_url` in two places:
  - Lines 233-239: Player photo display during voting
  - Lines 284-287: Player photo display in confirmation step

#### TeamDisplay.js
- Removed fallback to `foto_url` in player card display (lines 147-153)
- Removed console warning about using `foto_url` fallback

#### PlayerCard.js
- Verified this component was already correctly using `avatar_url` as the primary source for player photos

### 4. Data Handling in supabase.js

Updated several functions in `supabase.js` to remove fallbacks to `foto_url`:

- `updatePartidoFrecuente` function (line 816): Removed fallback to `foto_url`
- `crearPartidoDesdeFrec` function (line 892): Removed fallback to `foto_url`
- `submitVotos` function (lines 354-356): Removed `jugador_foto_url` field and kept only `jugador_avatar_url`

## Current State

The codebase now consistently uses the `usuarios` table and the `avatar_url` field as the single source of truth for user profile images. All fallbacks to `foto_url` have been removed, ensuring that profile images are handled consistently across the application.

The authentication flow correctly saves user data to the `usuarios` table on login, and all components that display profile images now use only the `avatar_url` field.

## Recommendations

1. **Database Cleanup**: Consider running a database migration to copy any remaining profile images from `foto_url` to `avatar_url` for users who haven't updated their profile since this refactoring.

2. **Database Schema Update**: After ensuring all data is migrated, consider removing the `foto_url` field from the database schema to prevent any future use.

3. **Monitoring**: Monitor the application for any issues related to profile images, especially for users who haven't logged in since this refactoring.

4. **Documentation**: Update any developer documentation to reflect that `usuarios.avatar_url` is now the only field used for profile images.

## Conclusion

This refactoring has successfully standardized profile image handling across the application, using only the `usuarios.avatar_url` field as the single source of truth. This will make the codebase more maintainable and reduce the risk of inconsistencies in profile image handling.