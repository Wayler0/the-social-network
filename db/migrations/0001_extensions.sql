-- 0001_extensions.sql
-- Hatua v0.1 — database extensions.
-- PostGIS is enabled now (CLAUDE.md section 12) so the v0.3 places tables
-- can be added later without touching the server setup.

CREATE EXTENSION IF NOT EXISTS postgis;
-- gen_random_uuid() is built into PostgreSQL 13+; no extension needed.
