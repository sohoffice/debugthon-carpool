-- +goose Up

-- Simulated demo accounts (DD-19): bearer token is `driver:<username>` / `passenger:<username>` (DD-18).
INSERT INTO users (username, display_name, is_driver, is_passenger, simulated) VALUES
    ('passenger1', '乘客 小美', false, true, true),
    ('passenger2', '乘客 小華', false, true, true),
    ('driver1',    '駕駛 鐵雄', true, false, true),
    ('driver2',    '駕駛 大明', true, false, true),
    ('driver3',    '駕駛 珍珍', true, false, true),
    ('driver4',    '駕駛 阿丁', true, false, true),
    ('driver5',    '駕駛 阿龍', true, false, true);

-- +goose Down
DELETE FROM users WHERE username IN
    ('passenger1', 'passenger2', 'driver1', 'driver2', 'driver3', 'driver4', 'driver5');
