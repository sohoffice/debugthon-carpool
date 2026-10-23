-- +goose Up

-- Reassign delay (REQ-050): after a decline, timeout or ended trip the next car is chosen and its
-- seat held at once, but it is offered the request only after this delay, so the passenger hears
-- of the reassignment before the next driver is asked. Adjustable with SQL like the others (DD-20).
INSERT INTO system_settings (key, value, unit, description) VALUES
    ('reassign_delay', 2, 's', '改配延遲：婉拒、逾時或行程結束後，過這段時間才把請求交給下一台車')
ON CONFLICT (key) DO NOTHING;

-- When the assigned driver may see the request; null on rows from before this column, which are
-- offered already. The response deadline counts from here.
ALTER TABLE ride_requests ADD COLUMN offered_at timestamptz;

-- +goose Down
ALTER TABLE ride_requests DROP COLUMN offered_at;
DELETE FROM system_settings WHERE key = 'reassign_delay';
