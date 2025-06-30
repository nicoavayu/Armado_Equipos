// src/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://rcyuuoaqfwcembdajcss.supabase.co";       // <-- pegá tu Project URL
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjeXV1b2FxZndjZW1iZGFqY3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzMTcwNzUsImV4cCI6MjA2Njg5MzA3NX0.X0Kv_k7VA3SgxquAC1LOwzMwZuzeKtN3W4BOl_AIsRs";      // <-- pegá tu anon/public API key

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
