-- +goose Up
-- Hysteresis for "passed the pickup point" (DD-06): a car counts as having left only once it is
-- beyond the pickup radius plus this margin, so positioning noise at the edge cannot latch it.
INSERT INTO system_settings (key, value, unit, description) VALUES
    ('pass_margin', 25, 'm', '離開緩衝：車輛離上車點超過「範圍半徑＋此值」才算已經過，避免定位誤差在範圍邊緣造成誤判')
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DELETE FROM system_settings WHERE key = 'pass_margin';
