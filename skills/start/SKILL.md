---
name: start
description: Get the existing Ketos RaytSystem workspace running and open its loopback-only interface. Use for start, launch, open RaytSystem, запусти, старт, or открой интерфейс requests in this repository.
version: "1.0.0-ketos.1"
test_status: pass
---

# Start RaytSystem for Ketos

Start the already bootstrapped workspace at `/Volumes/Projects/ketos_canvas_mod_main`.
Use the globally installed CLI directly. Talk to the user in their language.

## Procedure

1. Check the environment and canonical pointers:

```bash
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json
```

2. Confirm the current workspace state:

```bash
raytsystem status --root /Volumes/Projects/ketos_canvas_mod_main --json
```

3. If `config_exists` is false or the doctor reports a migration requirement, stop and report the
   exact blocker. Do not run bootstrap automatically in this configured repository.
4. When healthy, start the interface:

```bash
raytsystem start --root /Volumes/Projects/ketos_canvas_mod_main --host 127.0.0.1 --port 8765
```

5. Report the loopback URL `http://127.0.0.1:8765` and the actual doctor/status result.

## Safety

- Never overwrite, delete, or clean up user files.
- Never rerun bootstrap over the existing integration.
- Never push, publish, upload, enable remote execution, or promote a real corpus without separate
  scoped approval.
