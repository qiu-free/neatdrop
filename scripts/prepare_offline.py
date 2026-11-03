"""Explicit one-time model download. Inference never imports this script."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import httpx

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.offline import EXPECTED_HASHES
MODEL_DIR = PROJECT / 'models' / 'clip-vit-base-patch32'
REVISION = '6b7c523703ae26e39be4b03774966f8571c7f523'
FILES = ['onnx/vision_model_quantized.onnx', 'onnx/text_model_quantized.onnx',
         'tokenizer.json', 'preprocessor_config.json', 'config.json', 'README.md']
HOSTS = {'huggingface.co', 'hf-mirror.com', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co',
         'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co', 'cdn-lfs.hf.co'}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def download(client, url, target):
    for _ in range(8):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in HOSTS:
            raise RuntimeError(f'Download host is not allowed: {parsed.hostname}')
        with client.stream('GET', url) as response:
            if response.is_redirect:
                from urllib.parse import urljoin
                url = urljoin(url, response.headers['location'])
                continue
            response.raise_for_status()
            temporary = target.with_suffix(target.suffix + '.partial')
            total = 0
            with temporary.open('wb') as out:
                for block in response.iter_bytes(1024 * 1024):
                    total += len(block)
                    if total > 180 * 1024 * 1024:
                        raise RuntimeError('Model file larger than safety limit')
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
            temporary.replace(target)
            return
    raise RuntimeError('Too many download redirects')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mirror', action='store_true', help='Use public hf-mirror.com instead of Hugging Face')
    args = parser.parse_args()
    endpoint = 'https://hf-mirror.com' if args.mirror else 'https://huggingface.co'
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {'repository': 'Xenova/clip-vit-base-patch32', 'revision': REVISION,
                'license': 'MIT (see README.md)', 'source': endpoint, 'files': {}}
    old_path = MODEL_DIR / 'manifest.json'
    old = json.loads(old_path.read_text('utf-8')) if old_path.exists() else {}
    with httpx.Client(timeout=httpx.Timeout(180, connect=20), trust_env=False) as client:
        for name in FILES:
            target = MODEL_DIR / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not (target.exists() and old.get('revision') == REVISION and
                    old.get('files', {}).get(name) == sha256(target)):
                print('Downloading', name, flush=True)
                download(client, f'{endpoint}/Xenova/clip-vit-base-patch32/resolve/{REVISION}/{name}', target)
            manifest['files'][name] = sha256(target)
            if name in EXPECTED_HASHES and manifest['files'][name] != EXPECTED_HASHES[name]:
                raise RuntimeError(f'Checksum mismatch for {name}; model not enabled')
            print(name, target.stat().st_size, manifest['files'][name], flush=True)
    temporary = old_path.with_suffix('.json.partial')
    temporary.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    temporary.replace(old_path)
    print('Ready. Runtime loads only local files; no automatic downloads.', flush=True)


if __name__ == '__main__':
    main()
