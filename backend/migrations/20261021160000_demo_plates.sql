-- +goose Up

-- Demo vehicles of driver1..driver5 use plates ABC-0001..ABC-0005.
UPDATE vehicles SET plate = 'ABC-0001' WHERE user_id = (SELECT id FROM users WHERE username = 'driver1');
UPDATE vehicles SET plate = 'ABC-0002' WHERE user_id = (SELECT id FROM users WHERE username = 'driver2');
UPDATE vehicles SET plate = 'ABC-0003' WHERE user_id = (SELECT id FROM users WHERE username = 'driver3');
UPDATE vehicles SET plate = 'ABC-0004' WHERE user_id = (SELECT id FROM users WHERE username = 'driver4');
UPDATE vehicles SET plate = 'ABC-0005' WHERE user_id = (SELECT id FROM users WHERE username = 'driver5');

-- +goose Down
UPDATE vehicles SET plate = 'ABC-1234' WHERE user_id = (SELECT id FROM users WHERE username = 'driver1');
UPDATE vehicles SET plate = 'BCD-2345' WHERE user_id = (SELECT id FROM users WHERE username = 'driver2');
UPDATE vehicles SET plate = 'CDE-3456' WHERE user_id = (SELECT id FROM users WHERE username = 'driver3');
UPDATE vehicles SET plate = 'DEF-4567' WHERE user_id = (SELECT id FROM users WHERE username = 'driver4');
UPDATE vehicles SET plate = 'EFG-5678' WHERE user_id = (SELECT id FROM users WHERE username = 'driver5');
