# Workflow implementation task

Read 2026-11-03-daily-experience.md for scope. Own frontend/src/useWorkspace.ts,
types.ts,fileSelection.ts, components/Workbench.tsx,FileTable.tsx,Inspector.tsx,
PlanDialog.tsx,ConsentDialog.tsx,Modal.tsx and styles.css plus related tests.
Do not edit App.tsx, api.ts, SettingsDialog, HelpPage, Sidebar, tutorial/preferences
files or backend. No subagents. Work in place with TDD, run tests/build.

Implement choose/analyze/review/results workflow, empty landing with no empty table,
optional onTutorial callback in Workbench to enter practice, explicit empty selection,
bounded 50 items/200MiB visible-only selection preserving old selection on overflow.
Independent reviewed set; edit/reanalysis invalidates approval+plan; ordinary bulk
approval excludes review-required; manual/review-required individually approve before
plan. Filters unreviewed/review/failed/selected. Bulk category and unselect. Stage
navigation retains edits; confirm clear draft before scan/rescan. Detail responsive
closable drawer. Partial analysis merge while polling/current file/phase/cancel and
retry errors only; cloud retry reopens consent, binds config.model.endpoint/version.
Fixed plan explicit fresh checkbox, actual execution progress and results with
success/failed/not-run. Poll GET /workspaces/{id}/executions/{plan_id} returns
status,processed,total,current_file,items,error,transaction?; no automatic execute POST
retry after disconnect; query status and history. Root implements status endpoint.
Use refs for duplicate-click and stale-request protection; session/restart errors
guide directory/history recovery. Preferences module from learning agent exports
loadPreferences/savePreferences and default; only density/offlineFirst/tutorial.
Keep optional props for compatibility where practical, update tests where old behavior
contradicts accepted spec (e.g. auto-selection). Do not add tests mirroring source.

Write daily-workflow-report.md beside this file with summary/tests/concerns. Return
concise status. Notify root early of exported integration methods/types.
