# 分类纠错与日常整理优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task with RED/GREEN and review gates.

**Goal:** 实现目录个人规则、可操作识别诊断、资料库多条件筛选及入口简化。

**Architecture:** 安装本机有界规则存储和任务文本快照，预览凭据+版本化修改，离线任务在基础分类后提供规则候选。前端用复核展开面板及详情动作集成；新增筛选只在会话内存。

**Tech Stack:** Python3.12/FastAPI/pytest；React19/TypeScript/CSS/Vitest/Ego。

**Spec:** `docs/superpowers/specs/2026-11-12-classification-usability-design.md`

## Global Constraints

- 保留五项导航与蓝白主题，不恢复产品说明，不引入依赖/远程字体。
- 严格选择→分析→复核→独立确认→结果；规则不能自动审核执行。
- 原件、副本协议、Host/Origin/CSRF/回环和目录授权不弱化。
- 规则绑定目录路径+身份；2至5个全部匹配普通词，每词2至40字符且不重复/包含，名称1至60字符，扩展名限SUPPORTED，最多50规则/256KiB。
- 预览只用已结束离线任务的50份以内12000字符快照，受限/不可用排除；600秒单次凭据绑定目录/草稿/版本，零命中不能启用。
- 下一离线任务固定规则快照，命中仍复核，冲突不任取，云端不应用。
- 网页不调用本地规则API；浏览器不持久存路径/正文/规则，关键词仅明确启用到本机。
- entry ID预览核验不变；日期按本地日历，换目录/图谱指定文件清全部筛选。
- 不声称未经标注的准确率；保留未跟踪web-demo设计稿。

### Task 1: 后端规则、预览与任务集成

**Files:** Create `backend/neatdrop/personal_rules.py`, `backend/tests/test_personal_rules.py`, `backend/tests/test_personal_rules_api.py`; modify `analysis.py`, `app.py` and focused tests only.

**Interfaces:**

```text
PersonalRules(executor) uses executor.ws, executor.trust.path, TrustStore guard,
metadata_file, atomic os.replace and shared lock. Store by physical root identity.
GET /workspaces/{id}/classification-rules -> {revision,rules,available}
Rule={id,name,keywords,extensions,category,subcategory,enabled,created}
POST /.../classification-rules/preview
 {job_id,name,keywords,extensions,category,subcategory,rule_id?:str}
 -> {token,revision,rule,matched:[{file_id,name,keywords}],evaluated,excluded,total}
POST /.../classification-rules {preview_token,confirmed} -> listing (save/enable)
POST /.../classification-rules/{id}/disable {revision} -> listing
POST /.../classification-rules/{id}/enable {preview_token,confirmed} -> listing
DELETE /.../classification-rules/{id} {revision,confirmed} -> listing
Errors PERSONAL_RULE_*; report exact codes for frontend.
Tokens in Session: max16,600s,single use; server draft only, reject wrong route.
AnalysisJobs.create optional personal rule snapshot, defaults none for evaluation.
API reads rules only for local job. Retain bounded decoded text/quality/record per
completed local task with 900s job expiry, no durable bodies or re-extraction.
Suggestion.personal_rule_matches=[{id,name,keywords}], provider=personal_rules,
review_reasons personal_rule_applied/personal_rule_conflict/personal_rules_unavailable.
```

- [ ] Test invalid inputs/taxonomy, no confirmation/preview, wrong directory/job, expired/consumed/stale token, zero match, disable/re-enable/delete, opposing matches, limited quality, job snapshot stability, store corruption/links, local/cloud isolation and unchanged base pipeline.
- [ ] Run new pytest files and observe missing-feature RED.
- [ ] Implement bounded store/matching/API with existing guarded I/O; corruption cannot be silently replaced. Preview tokens cannot be forged using client-provided draft. Expired jobs prune samples/snapshots. No additional file scans.
- [ ] Run new tests plus test_analysis.py/test_classification_pipeline.py/test_api.py/test_parsing_security.py, fix regressions.
- [ ] Commit owned files. Write exact contracts, RED/GREEN commands/output, concerns to task-1-report.md in plan workspace.

### Task 2: 规则面板、识别恢复与界面简化

**Files:** Create `frontend/src/personalRuleTypes.ts`, `components/PersonalRulesPanel.tsx`, `components/RecognitionRecovery.tsx` and meaningful tests/CSS. Modify Workbench/Inspector/App/Sidebar/HelpPage/apiMessages/types and related tests. Leave library/session to Task3.

**Interfaces:** Consume Task1 final report. Workbench receives optional `onSettings:()=>void`, `onHelp:(topic:string)=>void`, App opens existing settings or help topic. Inspector callbacks for rule seed/retry/settings/help/manual focus. Rule seed `{fileId,category,subcategory}` from manually corrected and reviewed file. Current completed local job is `state.job.id`. Close detail before setting parent panel/help/settings/consent. Suggestion metadata shown as personal rule with name/keywords and review requirement.

```text
Rule panel only local workspace, in review '更多操作' or corrected+reviewed action.
Any form edit immediately clears preview/consent; ignore late responses after
draft/directory change. Explicit unchecked consent names persistent keywords.
Save requires matching preview with hits and consent, busy double-submit guard.
Disable/delete use server revision; delete confirm inside panel, no nested modal.
Reenable uses fresh preview with rule_id, success says '下次离线分析生效'.
Recovery maps raw error/reasons/quality/offline capabilities to explanatory text
and explicit settings/help/manual/retry/rescan action. No implicit cloud retry.
Keep exactly one local choose button visible at phone+desktop; path form remains.
Tutorial action text '安全练习'; move ordinary approval into existing More details.
```

- [ ] Read MASTER.md/craft-floor; create failing behavioral tests for correct+reviewed seed, stale preview, error/missing models/conflict/manual guards, mode hiding, one choose button and retained ordinary approval.
- [ ] Run focused Vitest RED; implement minimal UI matching tokens, keyboard/focus and bounded async lifecycle. No new side pages.
- [ ] Run changed tests plus App/Workbench/Inspector/Settings/Help/Tutorial and experience integration.
- [ ] Commit owned files. Write task-2-report.md with changed behavior/tests/limitations.

### Task 3: 资料库多条件筛选及会话保持

**Files:** Modify LibraryPage.tsx/library.css/pageSession.ts/App.tsx (library focus reset only), tests in LibraryPage/App/experience as required.

**Interfaces:** Extend LibrarySession with optional fields for compatibility with existing tests: `subcategory?:string,extension?:string,dateFrom?:string,dateTo?:string`. Defaults `all,all,'',''`. Current categories/subcategories from taxonomy, format options deduped from item.name suffix lowercased (not target paths). `subcategory=none` for null.

```typescript
// localDay = `${date.getFullYear()}-${pad(month+1)}-${pad(day)}`;
// accepted date inputs YYYY-MM-DD, from<=to, inclusive comparisons on localDay.
// Date-invalid records excluded only when date filter exists.
// All filters AND filename; clear-all action always visible when any active.
// Change category clears subcategory; no subtype choice if all main categories.
// workspace reset and graph focus reset ALL fields including old ones.
// Counts explicitly refer to loaded results and preserve truncation notice.
```

- [ ] Write failing filter-intersection, no-subtype, uppercase-format, date endpoints/invalid range, clear-all, revisit/replace-workspace/graph-focus regressions.
- [ ] Run focused tests RED; implement without changing library API/security or adding reads.
- [ ] Run LibraryPage/App/experience library tests; build TypeScript.
- [ ] Commit owned files, task-3-report.md with results. Review gate then integrate.

### Task 4: 整体验证、浏览器与文档交付

**Files:** docs/daily-use.md, README.md, MASTER.md, new docs/releases/2026-11-12-classification-usability.md. QA scripts only ignored scratch or external visualization folder.

- [ ] Run backend whole suite and frontend whole suite, local+experience builds and isolation checks; inspect results.
- [ ] Use synthetic authorized folder to create preview→enable→next-local-analysis candidate→disable/delete→stale rejection, hash originals; browser rule panel/diagnostics/filters and one-choose/consistent-practice flows. Never use personal directories or enable user rules without sample scope.
- [ ] Check desktop+390px keyboard/focus/motion, no horizontal overflow, no stale modal inert; screenshot when available, disclose any missing evidence.
- [ ] Run detector on changed UI and diff check. Update docs to actual supported flow/limits/no accuracy promise.
- [ ] Broad final code review over this plan range; address concrete findings, rerun covering tests only when changed.
- [ ] Commit, sync existing private feature branch, verify private flag+branch+PR head. Do not merge main or publish.
