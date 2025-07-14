-- Fix votante_id field to accept both UUID and text for guest voting
-- Run this in your Supabase SQL editor

-- Change votante_id from UUID to TEXT to support both authenticated users and guests
ALTER TABLE votos ALTER COLUMN votante_id TYPE TEXT;