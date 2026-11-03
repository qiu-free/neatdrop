# Daily learning UI delivery report

Implemented the preferences, first-run learning, searchable help, and settings surfaces.
App wiring is present for tour completion, practice completion, help callbacks, model
refresh, and Sidebar's persistent practice badge.

## Integration exports

- `preferences.ts`: `Preferences`, `Density`, `TutorialProgress`, `loadPreferences()` and
  `savePreferences(preferences)`. Stored JSON is limited to version 1, density,
  offline-first (defaults `true`) and tour/exercise completion flags. Successful saves
  dispatch `neatdrop:preferences` with the sanitized preference object in `detail`.
- `HelpPage`: `onPractice?: () => void`, `onReplayTour?: () => void`, and
  `exerciseCompleted?: boolean`; searchable topic cards have a focusable local
  anchor directory.
- `FirstRunTour`: `onClose` and optional `onPractice`; internally navigates the
  four skippable/replayable steps, while App owns whether the overlay is shown.
- `TutorialPractice`: `onClose`, `completed`, and `onComplete`; all six practice
  tasks mutate local component state only.
- `Sidebar`: optional `exerciseCompleted` badge and `onTutorial` callback.
- `SettingsDialog`: optional `onSaved` callback, uses the existing generic `api()`
  helper so `api.ts` stays root-owned. It surfaces `settings_error`, fails closed if
  settings cannot be loaded or are unreadable, clears replacement keys after
  save/test attempts, and warns before testing with a saved key at a changed endpoint.
- `TutorialExercise`: the sample-selection set matches each visible checkbox and
  the displayed batch count; the practice-analysis step requires the receipt sample.

Settings API contract read from the backend implementation: GET `/model-config` returns
`endpoint`, `text_model`, `vision_model`, `max_requests_per_batch`, `configured`,
`key_source`, `key_locked`, `config_version`, plus `<field>_source` and
`<field>_locked` for endpoint, text model, vision model and budget. POST
`/model-config` accepts those four values plus `key_action` (`keep` or `replace`), and
`api_key` only for replacement. Removal uses POST `/model-config/clear-key` with
`{ confirmed: true }`. Test uses POST `/model-config/test` with the visible target's
form values, `key_action`, optional replacement key, and `{ confirmed: true }` after
explicit consent. Test success is presented as fixed-text only and does not reveal
provider output.

Root App passes the persisted exercise flag to Sidebar and HelpPage. `SettingsDialog`
loads saved preferences directly when no controlled preference props are supplied.

## Workflow review

Read-only re-review confirmed that `useWorkspace.analyze()` takes a synchronous action
lock and rejects a second request while a queued or running job is tracked. Workbench
also disables analysis actions during a job. Reviewed files leave both the pending
review filter and its count. On narrow screens the inspector is exposed as a modal
dialog with Escape handling, Tab focus containment, focus restoration, and focus-aware
next/previous navigation. `App` passes the saved `offlineFirst` preference to
Workbench; cloud is the initial mode only when that preference is explicitly off and
a model is configured, and consent remains unchecked.

## Validation

- Focused HelpPage, SettingsDialog, and TutorialExercise tests: 16 passed across 3
  files, including load-failure write protection and sample-selection consistency.
- Full frontend suite: 74 passed across 15 files.
- Frontend production build: passed (`tsc -b` and Vite build; 1,587 modules).

No external model connection was made. Settings connection tests use a mocked local
API; the UI's provider request is only sent after the explicit checkbox is selected.
