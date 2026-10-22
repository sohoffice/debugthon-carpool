-- +goose Up

-- City admin role (Phase 2, DD-39): a third role next to driver and passenger. The unnamed CHECK
-- from create_schema got Postgres' default name users_check; it becomes "at least one of three".
ALTER TABLE users ADD COLUMN is_city_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users DROP CONSTRAINT users_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (is_driver OR is_passenger OR is_city_admin);

-- The dashboard account (DD-19): token `city:city1` (DD-18). Not simulated: the Demo reset leaves it alone.
INSERT INTO users (username, display_name, is_city_admin) VALUES ('city1', '市府 管理者', true)
ON CONFLICT (username) DO NOTHING;

-- +goose Down
DELETE FROM users WHERE username = 'city1';
DELETE FROM users WHERE NOT (is_driver OR is_passenger);
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_check CHECK (is_driver OR is_passenger);
ALTER TABLE users DROP COLUMN is_city_admin;
