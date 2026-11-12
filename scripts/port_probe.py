"""Loopback-only startup probe. No file inputs or external requests."""
import json
import socket
import urllib.request

def probe(port=8765):
    with socket.socket() as listener:
        try:
            listener.bind(('127.0.0.1', port))
            return 'free'
        except OSError:
            pass
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{port}/api/v1/health', timeout=2) as response:
            value = json.load(response)
        return 'neatdrop' if value.get('status') == 'ok' and value.get('execution_mode') == 'copy_only' else 'occupied'
    except (OSError, ValueError):
        return 'occupied'

if __name__ == '__main__':
    print(probe())
