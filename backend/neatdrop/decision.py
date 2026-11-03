"""Conservative decisions across distinct score spaces; never produces paths."""
import copy
import math

from .taxonomy import SUBCATEGORIES
from .classifier import PURPOSE_LABELS

FALLBACKS = {('other', 'unclassified'), ('photos', 'unsorted_photo')}


def valid_candidate(row):
    if not isinstance(row, dict):
        return False
    category, subtype = row.get('category'), row.get('subcategory')
    if not isinstance(category, str) or not isinstance(subtype, str):
        return False
    if subtype not in SUBCATEGORIES.get(category, {}) or (category, subtype) in FALLBACKS:
        return False
    score = row.get('score', 0)
    return isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score)


def decide(rule_result, semantic=None, sampling=None):
    result = copy.deepcopy(rule_result)
    reasons = list(result.get('review_reasons', []))
    warnings = list(result.get('engine_warnings', []))
    semantics = semantic or {}
    warnings.extend(semantics.get('warnings', []))
    rule_candidates = [dict(c, engine='rules') for c in result.get('candidates', []) if valid_candidate(c)]
    semantic_candidates = [dict(c, engine='semantic') for c in semantics.get('candidates', []) if valid_candidate(c)][:3]
    if 'low_information_image' in result.get('quality', {}).get('issues', []):
        semantic_candidates = []
    selected = (result.get('category'), result.get('subcategory'))
    known = selected[0] in SUBCATEGORIES and selected not in FALLBACKS and (
        selected[1] is None or selected[1] in SUBCATEGORIES[selected[0]])
    # Visual fusion can replace the text result; ensure that its selected label is
    # represented first rather than exposing stale text candidates as the decision.
    if known:
        selected_row = next((c for c in rule_candidates if (c['category'], c['subcategory']) == selected), None)
        if selected_row is None:
            selected_row = {'category': selected[0], 'subcategory': selected[1], 'engine': 'visual',
                            'evidence': '本地图像场景线索'}
        rule_candidates = [selected_row] + [c for c in rule_candidates if (c['category'], c['subcategory']) != selected]
    if not known and semantic_candidates:
        best = semantic_candidates[0]
        result.update(category=best['category'], subcategory=best['subcategory'])
        reasons = [r for r in reasons if r not in {'insufficient_evidence', 'vision_unavailable', 'visual_ambiguous'}]
        reasons.append('semantic_uncalibrated')
        result.setdefault('evidence_items', []).append({'source': 'semantic',
                                                       'text': best.get('evidence') or '与本地分类定义语义相近，尚未校准'})
        if len(semantic_candidates) > 1 and best['score'] - semantic_candidates[1]['score'] < .03:
            if best['category'] == semantic_candidates[1]['category']:
                result['subcategory'] = None
                reasons.append('subtype_ambiguous')
            else:
                reasons.append('competing_categories')
    elif known and semantic_candidates and (semantic_candidates[0]['category'], semantic_candidates[0]['subcategory']) != selected:
        reasons.append('engine_disagreement')
    # Rule scores compare only with rule scores. Same-parent ties are useful
    # main-only suggestions rather than a fabricated choice of child label.
    if known and 'competing_categories' in reasons and len(rule_candidates) > 1:
        first, second = rule_candidates[:2]
        if first['category'] == second['category'] and first.get('engine') == second.get('engine') == 'rules':
            result['subcategory'] = None
            reasons.append('subtype_ambiguous')
    merged = []
    seen = set()
    for row in rule_candidates + semantic_candidates:
        key = row['category'], row['subcategory']
        if key not in seen:
            seen.add(key)
            # Scores remain engine-specific diagnostic values, never percentages.
            merged.append(row)
    result['candidates'] = merged[:3]
    if sampling:
        result['sampling'] = copy.deepcopy(sampling)
        if sampling.get('truncated') or sampling.get('budget_exhausted'):
            reasons.append('partial_content')
    if semantics.get('truncated'):
        reasons.append('semantic_partial')
    if 'semantic_chunk_conflict' in warnings:
        reasons.append('conflicting_evidence')
    if semantics:
        result['semantic_details'] = {key: copy.deepcopy(semantics[key])
                                      for key in ('token_sampling', 'chunk_support') if key in semantics}
    if result.get('category') != 'other' and result.get('subcategory') is None:
        reasons.append('subtype_ambiguous')
    if (result.get('category'), result.get('subcategory')) in PURPOSE_LABELS:
        reasons.append('purpose_uncalibrated')
    if any(code in warnings for code in ('ocr_unavailable', 'inference_timeout', 'inference_failed',
                                        'inference_budget_exceeded', 'inference_cancelled', 'image_low_information')):
        reasons.append('engine_incomplete')
    if result.get('category') == 'other':
        result['category'], result['subcategory'] = 'other', 'unclassified'
        reasons.append('insufficient_evidence')
        level = 'abstain'
    else:
        # Preserve a legacy required-review bit even when its reason is absent.
        if result.get('review_required') and not reasons:
            reasons.append('weak_evidence')
        level = 'candidate' if reasons else 'ordinary'
    result['review_reasons'] = list(dict.fromkeys(reasons))
    result['review_required'] = level != 'ordinary'
    result['decision_level'] = level
    result['engine_warnings'] = list(dict.fromkeys(warnings))
    result['engine_versions'] = {'rules': '5', 'decision': '2', 'quality': '5_heuristic_not_calibrated',
                                 'semantic': semantics.get('version', 'unavailable')}
    return result
