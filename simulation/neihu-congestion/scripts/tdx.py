"""Call a TDX API path and save the JSON. Usage: tdx.py <env file> <api path with query> <output file>

The client credentials go to curl on stdin, never on the command line; the token is cached next to this script
with owner-only permissions and is never printed.
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ENV, PATH, OUT = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
TOKEN_FILE = Path(__file__).with_name('.tdx_token.json')
TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'


def env():
    values = {}
    for line in ENV.read_text().splitlines():
        name, _, value = line.partition('=')
        values[name.strip()] = value.strip().strip('"\'')
    return values


def token():
    if TOKEN_FILE.exists():
        cached = json.loads(TOKEN_FILE.read_text())
        if cached['expires_at'] > time.time() + 300:
            return cached['access_token']
    e = env()
    form = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': e['TDX_CLIENT_ID'], 'client_secret': e['TDX_CLIENT_SECRET']})
    raw = subprocess.run(['curl', '-s', '--max-time', '30', '-X', 'POST', TOKEN_URL, '-H', 'content-type: application/x-www-form-urlencoded', '--data-binary', '@-'],
                         input=form, capture_output=True, text=True, check=True).stdout
    data = json.loads(raw)
    if 'access_token' not in data:
        sys.exit(f"token request failed: {data.get('error')} {data.get('error_description', '')}")
    TOKEN_FILE.write_text(json.dumps({'access_token': data['access_token'], 'expires_at': time.time() + data['expires_in']}))
    os.chmod(TOKEN_FILE, 0o600)
    return data['access_token']


def main():
    url = PATH if PATH.startswith('http') else 'https://tdx.transportdata.tw' + PATH
    # The bearer header goes through a curl config on stdin so the token stays off the command line too.
    config = f'header = "Authorization: Bearer {token()}"\nheader = "Accept-Encoding: gzip"\n'
    res = subprocess.run(['curl', '-s', '--compressed', '--max-time', os.environ.get('TDX_TIMEOUT', '60'), '-w', '\n%{http_code}', '-K', '-', url],
                         input=config, capture_output=True, text=True, check=True).stdout
    body, _, status = res.rpartition('\n')
    OUT.write_text(body)
    print(f'HTTP {status}, {len(body)} bytes -> {OUT.name}')
    if status != '200':
        print(body[:400])


main()
