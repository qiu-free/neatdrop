"""Regenerate the frontend cold-start labels from the authoritative backend."""
import argparse
import json
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'backend'))
from neatdrop.taxonomy import FORMS, taxonomy_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROJECT / 'frontend/src/taxonomy.generated.json')
    args = parser.parse_args()
    data = {'taxonomy': taxonomy_config(), 'content_forms': dict(FORMS)}
    args.output.write_bytes((json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
