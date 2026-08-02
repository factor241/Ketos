# CI/CD Pipeline Templates

Ready-to-use workflow files for the Flow DevOps Toolkit.
Copy the files you need into your project's CI configuration.

## GitHub Actions

| File | Trigger | Secrets needed |
|------|---------|----------------|
| [`github-actions/ketos-validate.yml`](github-actions/ketos-validate.yml) | PR touching `flows/**/*.json` | None |
| [`github-actions/ketos-test.yml`](github-actions/ketos-test.yml) | PR touching flows or tests | `KETOS_STAGING_API_KEY` |
| [`github-actions/ketos-push.yml`](github-actions/ketos-push.yml) | Push to `main` touching flows | `KETOS_PROD_API_KEY` |

### Quick start

```bash
mkdir -p .github/workflows
cp github-actions/ketos-validate.yml \
   github-actions/ketos-test.yml \
   github-actions/ketos-push.yml \
   .github/workflows/
```

Configure these in **Settings → Environments**:

**`staging`** environment (used by `ketos-test.yml`):
| Name | Type | Value |
|------|------|-------|
| `KETOS_STAGING_URL` | Variable | `https://staging.ketos.example.com` |
| `KETOS_STAGING_API_KEY` | Secret | your staging API key |

**`production`** environment (used by `ketos-push.yml`):
| Name | Type | Value |
|------|------|-------|
| `KETOS_PROD_URL` | Variable | `https://ketos.example.com` |
| `KETOS_PROD_API_KEY` | Secret | your production API key |
| `KETOS_PROJECT_NAME` | Variable | `Production Flows` *(optional)* |

Add **Required reviewers** to the `production` environment to gate every deploy
behind a manual approval step.

---

## GitLab CI

| File | Description |
|------|-------------|
| [`gitlab-ci/ketos.yml`](gitlab-ci/ketos.yml) | Three-stage template: validate → test → deploy |

### Quick start

```bash
mkdir -p .gitlab/ci
cp gitlab-ci/ketos.yml .gitlab/ci/
```

Add to your `.gitlab-ci.yml`:

```yaml
include:
  - local: .gitlab/ci/ketos.yml
```

Configure these in **Settings → CI/CD → Variables**:

| Variable | Protected | Masked | Description |
|----------|-----------|--------|-------------|
| `KETOS_STAGING_URL` | ✓ | ✗ | Staging instance URL |
| `KETOS_STAGING_API_KEY` | ✓ | ✓ | Staging API key |
| `KETOS_PROD_URL` | ✓ | ✗ | Production instance URL |
| `KETOS_PROD_API_KEY` | ✓ | ✓ | Production API key |
| `KETOS_PROJECT_NAME` | ✗ | ✗ | Project folder name *(optional)* |

---

## Shell scripts (`ci/`)

The `shell/` templates (`ci-validate.sh`, `ci-test.sh`, `ci-push.sh`) work with
any CI system (Jenkins, CircleCI, Bitbucket Pipelines, Azure Pipelines, etc.).
They are copied to `ci/` by `kfx init`.

### Environment variables

#### `ci-validate.sh`

| Variable | Default | Description |
|----------|---------|-------------|
| `FLOWS_DIR` | `flows/` | Directory containing flow JSON files |
| `VALIDATE_LEVEL` | `4` | Validation depth (1–4) |
| `VALIDATE_FORMAT` | `text` | Output format: `text` or `json` |
| `KFX_VERSION` | *(latest)* | PEP 508 version specifier for `kfx`, e.g. `>=0.4,<1` or `==1.2.3` |

#### `ci-test.sh`

| Variable | Default | Description |
|----------|---------|-------------|
| `KETOS_URL` | — | URL of target Ketos instance (Approach A) |
| `KETOS_API_KEY` | — | API key for target instance (Approach A) |
| `KETOS_ENV` | — | Environment name from config (Approach B) |
| `KETOS_ENVIRONMENTS_FILE` | `ketos-environments.toml` | Path to environments config (Approach B) |
| `TESTS_DIR` | `tests/` | Directory containing test files |
| `PYTEST_MARKERS` | `integration` | Markers passed to `pytest -m` |
| `PYTEST_ARGS` | — | Extra arguments forwarded verbatim to pytest |
| `SDK_VERSION` | *(latest)* | PEP 508 version specifier for `ketos-sdk` |

#### `ci-push.sh`

| Variable | Default | Description |
|----------|---------|-------------|
| `KETOS_URL` | — | URL of target Ketos instance (Approach A) |
| `KETOS_API_KEY` | — | API key for target instance (Approach A) |
| `KETOS_ENV` | — | Environment name from config (Approach B) |
| `KETOS_ENVIRONMENTS_FILE` | `ketos-environments.toml` | Path to environments config (Approach B) |
| `FLOWS_DIR` | `flows/` | Directory containing flow JSON files |
| `KETOS_PROJECT` | — | Project (folder) name on the remote instance |
| `KETOS_PROJECT_ID` | — | Project UUID (takes precedence over `KETOS_PROJECT`) |
| `DRY_RUN` | `false` | Set to `true` to preview without making changes |
| `KFX_VERSION` | *(latest)* | PEP 508 version specifier for `kfx` |

---

## How it all fits together

```
PR opened
  │
  ├── ketos-validate  ──── kfx validate flows/ --level 4
  │                           ↳ blocks merge if any flow is malformed
  │
  └── ketos-test  ──────── pytest tests/ --ketos-env staging
                              ↳ skips gracefully if staging is unavailable

Merge to main
  │
  └── ketos-push  ──────── kfx push --dir flows/ --env production
                              ↳ upserts every flow by stable ID
                              ↳ idempotent: safe to re-run
```

## Writing integration tests

Install the testing extra:

```bash
pip install "ketos-sdk[testing]"
```

Create `tests/test_flows.py`:

```python
def test_rag_flow(flow_runner):
    response = flow_runner("rag-endpoint", "What is Ketos?")
    assert "Ketos" in response.first_text_output()

async def test_async_flow(async_flow_runner):
    response = await async_flow_runner("my-endpoint", "Hello!")
    assert response.first_text_output() is not None
```

Run locally against staging:

```bash
KETOS_URL=https://staging.ketos.example.com \
KETOS_API_KEY=<key> \
pytest tests/ -m integration
```
