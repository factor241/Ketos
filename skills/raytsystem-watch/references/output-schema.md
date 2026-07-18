# Result schema

Return a human-readable projection backed by a typed result equivalent to:

```json
{
  "schema_version": "raytsystem.watch.result.v1",
  "run_id": "watch_stable-id",
  "status": "complete|partial|blocked",
  "mode": "summary|timeline|automation|frames|transcript",
  "source": {
    "kind": "local_file|url|transcript",
    "display_identity": "safe redacted identity",
    "content_sha256": "sha256 or null before acquisition",
    "url_identity_sha256": "safe URL identity hash or null",
    "duration_ms": null,
    "streams": []
  },
  "transcript": {
    "method": "embedded_caption|public_caption|local_asr|supplied|none",
    "language": null,
    "artifact_ref": null,
    "cue_count": 0,
    "confidence": null
  },
  "timeline": [],
  "summary": [],
  "automation_brief": null,
  "frames": [],
  "artifacts": [],
  "tool_versions": [],
  "limitations": [],
  "errors": [],
  "approvals": []
}
```

## Human projection

Always include source identity, status, selected mode, transcript method, evidence-typed findings,
important timestamps or explicit timestamp gaps, local derivative references, source identity hash,
tool versions, limitations, uncertainty, redactions, and partial failures.

Keep speech, shown content, screen text, actions, transitions, and inferences separate. Do not merge
conflicting evidence. Use `null` for unavailable timestamps and paraphrase by default.
