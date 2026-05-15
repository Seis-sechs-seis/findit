# SQL setup order

Use this folder for manual Supabase SQL setup.

## Fresh Supabase project

1. Run `supabase-schema.sql`
2. Run `supabase-rbac-migration.sql` (safe even on fresh schema)
3. (Optional) Run `items.sql` for sample data

## Existing Supabase project

1. Run `supabase-rbac-migration.sql`
2. (Optional) Run `items.sql` for sample data

## Notes

- `supabase-rbac-migration.sql` is idempotent-friendly for existing tables.
- `items.sql` uses `ON CONFLICT (id) DO NOTHING`, so it can be re-run safely.
- App-side auth/session still requires `.env` values:
  - `DB_PROVIDER=supabase`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (or fallback `SUPABASE_ANON_KEY`)
  - `SESSION_SECRET`
  - optional `ADMIN_EMAIL` for admin bootstrap
