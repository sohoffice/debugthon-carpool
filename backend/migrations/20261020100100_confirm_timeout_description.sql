-- +goose Up
-- The 60 s confirm timeout is decided (carpool-oi-09); it stays adjustable with SQL (DD-20).
UPDATE system_settings SET description = '駕駛確認時限：駕駛未在時限內回應即改配'
 WHERE key = 'driver_confirm_timeout';

-- +goose Down
UPDATE system_settings SET description = '駕駛確認時限：駕駛未在時限內回應即改配（暫定值）'
 WHERE key = 'driver_confirm_timeout';
