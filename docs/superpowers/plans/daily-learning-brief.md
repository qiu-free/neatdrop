# Tutorial, preferences and settings UI task

Read 2026-11-03-daily-experience.md for scope. Own frontend/src/preferences.ts,
components/HelpPage.tsx,Sidebar.tsx,SettingsDialog.tsx and NEW Tutorial/Tour components,
isolated tutorial.css/settings.css, local SVG help illustrations, related NEW tests.
Do not edit App.tsx, types.ts, styles.css, api.ts, core workflow or backend. No subagents.
Implement four-step skippable/replayable first-run tour; six-task fully in-memory
exercise (sample, viewing vs selection, mock local analysis, edit/review, mock confirm
archive, mock results/undo). Persistent exercise badge. Absolutely no real APIs from
exercise. Searchable help with local illustrations/topics from plan. Whitelist versioned
density/offlineFirst/tutorial progress preferences only; tolerate malformed/unavailable
storage; never paths/filenames/plans/keys. Export loadPreferences/savePreferences
with clear types; coordinate integration with root. App root controls tutorial/page/tour.

Settings actual form for offline status, bailian/custom endpoint, key keep/replace/
remove, models,budget; endpoint/env locks/field source; key cleared after submit;
config GET/POST /model-config, POST /model-config/clear-key, /model-config/test.
Use own settingsTypes.ts if needed (do not edit shared types.ts). API shape coordinate
with backend agent through root or collaboration message. Show Chat Completions-only,
save no network, test explicit checkbox/target/cost notice, text-only success. Optional
onSaved callback from App can refresh config. Display density/offline preference UI.

TDD and test without paid network. Write daily-learning-report.md beside this file
with changes/tests/concerns and exported integration APIs. Return concise status.
