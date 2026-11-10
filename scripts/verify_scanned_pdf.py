"""Synthetic end-to-end scan proof; never reads user documents."""
import io
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

def main():
    from PIL import Image
    from neatdrop.analysis import decode_input
    from neatdrop.classification_pipeline import classify_payload
    image = Image.open(ROOT / 'frontend/src/experience/records/paper.png').convert('RGB')
    output = io.BytesIO(); image.save(output, format='PDF', save_all=True, append_images=[image] * 4)
    os.environ['NEATDROP_SCANNED_PDF_OCR'] = '1'
    started = time.monotonic()
    payload = decode_input(output.getvalue(), '.pdf', local=True)
    result = classify_payload({'id': 'synthetic', 'name': 'scan.pdf', 'extension': '.pdf'}, payload)
    evidence = {'synthetic': True, 'elapsed_ms': round((time.monotonic() - started) * 1000), 'chars': len(payload['text']), 'sampling': payload['sampling'], 'warnings': payload['warnings'], 'category': result['category'], 'subcategory': result['subcategory'], 'review_required': result['review_required'], 'evidence_locations': [{key: row[key] for key in ['page', 'box', 'source'] if key in row} for row in result['evidence_items']]}
    path = ROOT / '.cache/scanned-pdf-proof.json'; path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(evidence, ensure_ascii=True))

if __name__ == '__main__':
    main()
