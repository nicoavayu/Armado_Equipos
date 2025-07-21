# Database Migrations

This directory contains SQL migration files for the Team Balancer application.

## How to Run Migrations

To run the migrations, you can use the Supabase CLI or execute the SQL directly in the Supabase dashboard.

### Using Supabase CLI

1. Install the Supabase CLI if you haven't already:
   ```bash
   npm install -g supabase
   ```

2. Login to your Supabase account:
   ```bash
   supabase login
   ```

3. Run the migration:
   ```bash
   supabase db push --db-url=YOUR_SUPABASE_URL
   ```

### Using Supabase Dashboard

1. Log in to your Supabase dashboard
2. Go to the SQL Editor
3. Copy the contents of the migration file
4. Paste into the SQL Editor and run the query

## Migration Files

- `add_surveys_sent_to_partidos.sql`: Adds a `surveys_sent` boolean field to the `partidos` table to track whether post-match survey notifications have been sent for a match. Also adds a `hora_fin` timestamp field to track when a match ends.