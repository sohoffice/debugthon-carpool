"""Serves the story-mode prototype on 127.0.0.1:5180.

config.js is generated per request from VITE_GOOGLE_MAPS_API_KEY in the repo-root .env, so the key
never lands in this folder or in git.
"""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / '.env'
PORT = 5180


def maps_key():
    if not ENV_FILE.exists():
        return ''
    for line in ENV_FILE.read_text().splitlines():
        name, _, value = line.partition('=')
        if name.strip() == 'VITE_GOOGLE_MAPS_API_KEY':
            return value.strip().strip('"\'')
    return ''


class Handler(SimpleHTTPRequestHandler):
    # The prototype changes often; never let the browser keep a stale copy of the page or data.js.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] != '/config.js':
            return super().do_GET()
        body = f'window.STORY_CONFIG = {json.dumps({"mapsKey": maps_key()})}\n'.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/javascript; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print(f'story prototype on http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=str(HERE))).serve_forever()
