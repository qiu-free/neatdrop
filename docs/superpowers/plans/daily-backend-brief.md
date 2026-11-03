# Backend settings and analysis task

Read 2026-11-03-daily-experience.md for global constraints and secure settings details.
Own backend/neatdrop/configuration.py (new), model.py, analysis.py, app.py and NEW
backend tests. Do not edit executor.py or frontend files. No subagents. Work in place;
no Git repository. Use TDD meaningful regressions and run them. Existing tests must
stay compatible; report any necessary contract changes to root.

Implement DPAPI encrypted atomic versioned settings, redacted query, keep/replace/
clear secret, environment precedence and endpoint locking, endpoint/key binding.
GET/POST /api/v1/model-config, POST /clear-key and /test subpaths. Test connection
explicit confirmed boolean, fixed sample text only and budget1, no save-time network.
Public HTTPS static and DNS validation, pinned validated IP with original TLS name,
redirect/proxy disabled. Maintain response/time/resource limits. Model module should
support immutable config snapshot passed to suggest; keep compatibility with old
tests patching suggest(payload). Cloud jobs bind endpoint/config_version consent,
configuration changed requires fresh authorization. /config model must expose
endpoint and config_version without secret. Incremental current_file/current_file_id/
phase in analysis; snapshots deep copied thread safely, results available during job.
Root owns execution progress and will add its GET route later, avoid editing executor.

Write docs/superpowers/plans/daily-backend-report.md with changes, tests and concerns;
return concise status. Skill paths in catalog exist under plugin cache (old user paths
are missing). Test commands may require sandbox escalation; EPERM is environmental.
