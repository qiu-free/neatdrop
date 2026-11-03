"""Explicitly prepare/import the pinned MIT BGE CPU candidate package.

Usage: python scripts/prepare_semantic.py --mirror --accept-license
       python scripts/prepare_semantic.py --import-from /local/package --accept-license
Inference never imports this downloader. No credentials or remote-code loaders.
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit

import httpx

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.semantic import (MODEL_DIR, REPOSITORY, REVISION, TRUSTED_FILES,
                               UPSTREAM_REVISION, package_manifest, read_verified_package, run_worker, verify_package)

HOSTS = {'huggingface.co', 'hf-mirror.com', 'cdn-lfs.huggingface.co',
         'cdn-lfs-us-1.hf.co', 'cdn-lfs.hf.co', 'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co'}
MAX_REDIRECTS = 5
PACKAGE_CAP = 32 * 1024 * 1024


def safe_relative(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\0' in name:
        raise ValueError('unsafe relative model path')
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {'..', '.'} for part in name.split('/')) or '' in name.split('/'):
        raise ValueError('unsafe relative model path')
    return path


def validate_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in {None, 443} or parsed.fragment:
        raise ValueError('model download URL is not allowed')
    return url


def download(client, url, target, size_cap):
    """Validate every redirect; bound both compressed wire body and decoded bytes."""
    target = Path(target)
    partial = target.with_name(target.name + '.partial')
    try:
        for redirects in range(MAX_REDIRECTS + 1):
            validate_url(url)
            with client.stream('GET', url, follow_redirects=False) as response:
                if response.is_redirect:
                    if redirects == MAX_REDIRECTS or 'location' not in response.headers:
                        raise ValueError('model download redirect limit')
                    url = urljoin(url, response.headers['location'])
                    continue
                response.raise_for_status()
                if int(response.headers.get('content-length', '0')) > size_cap:
                    raise ValueError('model download exceeds size limit')
                total = 0
                with partial.open('xb') as stream:
                    for block in response.iter_bytes(256 * 1024):
                        total += len(block)
                        if total > size_cap:
                            raise ValueError('model download exceeds size limit')
                        stream.write(block)
                    stream.flush()
                    os.fsync(stream.fileno())
                partial.replace(target)
                return
        raise ValueError('model download redirect limit')
    finally:
        if partial.exists():
            partial.unlink()


def source_url(name, endpoint):
    safe_relative(name)
    if name == 'UPSTREAM_README.md':
        return f'{endpoint}/BAAI/bge-small-zh-v1.5/resolve/{UPSTREAM_REVISION}/README.md'
    if name == 'pooling_config.json':
        return f'{endpoint}/BAAI/bge-small-zh-v1.5/resolve/{UPSTREAM_REVISION}/1_Pooling/config.json'
    return f'{endpoint}/{REPOSITORY}/resolve/{REVISION}/{name}'


def _check_file(path, trusted):
    if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()) or not path.is_file() or path.stat().st_size != trusted['size']:
        raise ValueError('model import file size/integrity mismatch')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != trusted['sha256']:
        raise ValueError('model file checksum mismatch')


def prepare(destination=MODEL_DIR, source=None, endpoint='https://huggingface.co'):
    destination = Path(destination).absolute()
    if destination.is_symlink() or (hasattr(destination, 'is_junction') and destination.is_junction()):
        raise ValueError('unsafe destination')
    if sum(item['size'] for item in TRUSTED_FILES.values()) > PACKAGE_CAP:
        raise ValueError('package size limit')
    if destination.exists():
        verify_package(destination)
        run_worker(destination, '', operation='selftest')
        return destination
    imported_bytes = None
    if source is not None:
        source = Path(source).absolute()
        # Local import is an allowlisted set of ordinary files, never archive
        # extraction or an imported user-supplied manifest trust root.
        if source.is_symlink() or (hasattr(source, 'is_junction') and source.is_junction()):
            raise ValueError('unsafe import directory')
        # Source content is read only through pinned directories and no-follow
        # locked handles, then retained as checked immutable bytes for copying.
        imported_bytes = read_verified_package(source)['files']
    validate_url(endpoint)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Only this fresh, checked sibling staging directory is removed on failure.
    # Publishing by rename cannot expose partially downloaded model files.
    with tempfile.TemporaryDirectory(prefix='.semantic-stage-', dir=destination.parent) as staging:
        stage = Path(staging)
        if not stage.resolve().is_relative_to(destination.parent.resolve()):
            raise ValueError('unsafe staging directory')
        with httpx.Client(timeout=httpx.Timeout(180, connect=20), trust_env=False, headers={'Accept-Encoding': 'identity'}) as client:
            for name, trusted in TRUSTED_FILES.items():
                target = stage.joinpath(*safe_relative(name).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                if source is not None:
                    target.write_bytes(imported_bytes[name])
                else:
                    print('Downloading', name, flush=True)
                    download(client, source_url(name, endpoint), target, trusted['size'])
                _check_file(target, trusted)
                print(name, trusted['size'], trusted['sha256'], flush=True)
        manifest_path = stage / 'manifest.json'
        with manifest_path.open('x', encoding='utf-8') as stream:
            json.dump(package_manifest(), stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        verify_package(stage)
        run_worker(stage, '', operation='selftest')
        # The exact destination must remain absent. Existing packages are never
        # deleted/replaced, preserving the previously enabled engine on failure.
        if destination.exists():
            raise ValueError('destination appeared during preparation')
        stage.rename(destination)
        # TemporaryDirectory cleanup sees an absent source after successful rename.
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mirror', action='store_true', help='Use explicit public hf-mirror.com mirror; same pinned checksums')
    parser.add_argument('--import-from', type=Path, help='Import only the pinned package files from a local directory')
    parser.add_argument('--destination', type=Path, default=MODEL_DIR)
    parser.add_argument('--accept-license', action='store_true', help='Acknowledge MIT model license (included in UPSTREAM_README.md)')
    args = parser.parse_args()
    if not args.accept_license:
        parser.error('Read MIT license at https://huggingface.co/BAAI/bge-small-zh-v1.5 and pass --accept-license')
    prepared = prepare(args.destination, args.import_from, 'https://hf-mirror.com' if args.mirror else 'https://huggingface.co')
    print('Verified CPU selftest passed; candidate-only package published:', prepared)


if __name__ == '__main__':
    main()
