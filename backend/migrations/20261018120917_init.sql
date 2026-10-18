-- +goose Up
-- Application role. Roles are cluster-wide, so guard against it already existing.
-- The password is a local-demo default (DD-24); change it for any shared environment.
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carpool') THEN
        CREATE ROLE carpool LOGIN PASSWORD 'carpool';
    END IF;
END
$$;
-- +goose StatementEnd

-- Tables and sequences created later by the migrator are usable by the app role.
GRANT USAGE ON SCHEMA public TO carpool;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carpool;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO carpool;
