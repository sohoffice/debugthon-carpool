-- +goose Up
-- Park place list (DD-28): destinations are searched by name or address from this list. It holds
-- only public buildings and addresses (REQ-064), and only places inside the park boundary
-- (backend/config/park/boundary.geojson; a Go test checks every row against it).
CREATE TABLE places (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name    text             NOT NULL UNIQUE,
    address text             NOT NULL,
    lat     double precision NOT NULL,
    lng     double precision NOT NULL
);

-- Demo seed. Coordinates are taken next to bus stops inside the park, so they are in bounds.
INSERT INTO places (name, address, lat, lng) VALUES
    ('仁寶電腦大樓', '台北市內湖區瑞光路581號', 25.07921, 121.56850),
    ('瑞光路 內科大樓 A', '台北市內湖區瑞光路（示範地址）', 25.0768, 121.5738),
    ('基湖路 內科大樓 B', '台北市內湖區基湖路（示範地址）', 25.07973, 121.56461),
    ('港墘路 內科大樓 C', '台北市內湖區港墘路（示範地址）', 25.07585, 121.57450),
    ('陽光街 內科大樓 D', '台北市內湖區陽光街（示範地址）', 25.07306, 121.57669),
    ('行善路 內科大樓 E', '台北市內湖區行善路（示範地址）', 25.05707, 121.57666),
    ('行愛路 內科大樓 F', '台北市內湖區行愛路（示範地址）', 25.06387, 121.58004),
    ('文湖路 內科大樓 G', '台北市內湖區文湖街（示範地址）', 25.08415, 121.56152),
    ('成功路 內科大樓 H', '台北市內湖區成功路（示範地址）', 25.05474, 121.58207),
    ('週美街 內科大樓 I', '台北市內湖區週美街（示範地址）', 25.05609, 121.58191)
ON CONFLICT (name) DO NOTHING;

-- +goose Down
DROP TABLE places;
