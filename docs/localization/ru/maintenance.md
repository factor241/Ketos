# Сопровождение русской локализации

Русский входит в обязательный список целевых языков IBM Globalization Pipeline для frontend-пакета `langflow-ui` и backend-пакета `langflow-ui-backend-v2`. Оба пакета проходят один и тот же управляемый цикл; локальный `ru.json`, созданный в обход этого цикла, не считается готовым к выпуску.

## Цикл обновления

1. Обновить English source через extraction и выполнить локальные locale contracts.
2. Загрузить source-пакеты:

   ```bash
   cd scripts/gp
   python upload.py --target frontend --source ../../src/frontend/src/locales/en.json
   python upload.py --target backend
   ```

3. Дождаться полного статуса перевода. Для backend при наличии разрешённых GP credentials:

   ```bash
   uv run python scripts/gp/check_backend_status.py --lang ru
   ```

   Команда возвращает `0` только если каждый source key имеет непустое русское значение; missing key, пустое значение или transport error возвращает `1`. Для frontend отдельного status endpoint в текущем клиенте нет: credential-safe preflight выполняется download в изолированный каталог на следующем шаге.

4. Скачать оба пакета:

   ```bash
   cd scripts/gp
   python download.py --target frontend --lang ru --source ../../src/frontend/src/locales/en.json --output ../../src/frontend/src/locales
   python download.py --target backend --lang ru --source ../../src/backend/base/langflow/locales/en.json --output ../../src/backend/base/langflow/locales
   ```

   Download атомарен на уровне запуска: пустой каталог, missing source key, пустое значение, credential match или ошибка любого выбранного языка завершают команду ошибкой до записи файлов. Дополнительные plural keys допустимы на этом слое и отдельно проверяются locale gates. Существующий проверенный каталог при этом не перезаписывается.

5. Проверить контракты:

   ```bash
   cd src/frontend
   npm run i18n:check
   npm run i18n:check-keys
   cd ../../
   uv run python scripts/gp/extract_backend_strings.py --check
   uv run python scripts/i18n/check_backend_locales.py
   uv run pytest scripts/gp/tests -q
   ```

6. Провести независимую языковую проверку по `glossary.md` и `style-guide.md`, записать `APPROVED` или `CHANGES_REQUESTED` в `linguistic-review.md`.
7. Слить translation PR вручную только после зелёных locale checks и `APPROVED`. Workflow намеренно не включает auto-merge и не пропускает CI.

## Матрица environment names

Значения не включаются в логи, evidence и shell history.

| Name | Тип | Обязателен | Назначение |
|---|---|---:|---|
| `GP_ADMIN_USER_ID` | secret | да, live GP | идентификатор HMAC |
| `GP_ADMIN_PASSWORD` | secret | да, live GP | ключ HMAC |
| `GP_INSTANCE` | variable | да, live GP | GP instance |
| `GP_BUNDLE` | variable | да, frontend | frontend bundle |
| `GP_BACKEND_BUNDLE` | variable | да, backend | backend bundle |
| `GP_CA_BUNDLE` | variable | нет | путь к PEM bundle приватного CA; без него используется системное хранилище доверия |
| `GP_VERIFY_SSL` | variable | нет | legacy guard; допускаются только true-значения, отключение TLS verification блокируется |
| `GP_TRANSLATION_PR_TOKEN` | secret | да, workflow | fine-grained PAT, чтобы созданный PR запускал `pull_request` required checks |
| `GP_LINGUISTIC_REVIEWER` | variable | да, workflow | GitHub reviewer для ручного linguistic gate |

Presence проверяется только по именам и boolean-состоянию; запрещены `env`, `printenv`, `set`, `set -x` и вывод значений. Минимальные права `GP_TRANSLATION_PR_TOKEN`: repository contents write и pull requests write. Стандартный `GITHUB_TOKEN` не является заменой: созданные им события не гарантируют запуск required `pull_request` checks.

## Секреты и журналы

`GP_ADMIN_USER_ID` и `GP_ADMIN_PASSWORD` передаются только через защищённое окружение CI или локальные environment variables. Нельзя печатать credentials, HMAC `Authorization` header, полный environment или содержимое `.env`. Ошибки допускается журналировать только без request headers и секретных значений.

Скрипты не печатают GP response body и текст transport exception. Download перед записью также отклоняет каталог, содержащий текущее значение GP credential. Workflow не публикует каталоги или logs как Actions artifacts до прохождения validation.

## Внешний live GP gate и evidence template

Этот gate выполняется только в разрешённом secret environment. Локальные mocks и unit tests не заменяют его. До начала зафиксировать reviewable commit; для каждого шага сохранить exit code, UTC timestamps и URL/ID Actions run, но не command environment.

```text
R6 LIVE GP EVIDENCE
status: PASS | BLOCKED | FAIL
commit_sha: <40 hex>
gp_run_url: <https://github.com/.../actions/runs/...>
gp_run_id: <numeric id>
operator_role: <role, no personal credential>
started_at_utc: <ISO-8601>
finished_at_utc: <ISO-8601>

environment_name_presence:
  GP_ADMIN_USER_ID: PRESENT | ABSENT
  GP_ADMIN_PASSWORD: PRESENT | ABSENT
  GP_INSTANCE: PRESENT | ABSENT
  GP_BUNDLE: PRESENT | ABSENT
  GP_BACKEND_BUNDLE: PRESENT | ABSENT
  GP_TRANSLATION_PR_TOKEN: PRESENT | ABSENT
  GP_LINGUISTIC_REVIEWER: PRESENT | ABSENT

frontend:
  bundle_name: <non-secret name>
  target_language: ru
  source_path: src/frontend/src/locales/en.json
  source_sha256: <sha256>
  upload_exit: <integer>
  ru_preflight_download_exit: <integer>
  downloaded_path: src/frontend/src/locales/ru.json
  target_sha256: <sha256>
  diff_name_status_path: <artifact path>

backend:
  bundle_name: <non-secret name>
  target_language: ru
  source_path: src/backend/base/langflow/locales/en.json
  source_sha256: <sha256>
  upload_exit: <integer>
  status_exit: <integer>
  status_result: COMPLETE | INCOMPLETE | ERROR
  downloaded_path: src/backend/base/langflow/locales/ru.json
  target_sha256: <sha256>
  diff_name_status_path: <artifact path>

negative_proof:
  empty_download_exit: <non-zero integer>
  partial_keyset_download_exit: <non-zero integer>
  existing_catalog_sha256_before: <sha256>
  existing_catalog_sha256_after: <same sha256>
  credential_token_scan_result: PASS | FAIL

translation_pr:
  url: <https://github.com/.../pull/...>
  head_sha: <40 hex>
  is_draft_initially: true
  auto_merge_request: null
  required_check_ci_success: SUCCESS | FAILURE | PENDING | MISSING
  required_check_i18n_contract_gates: SUCCESS | FAILURE | PENDING | MISSING
  branch_protection_required: true | false
  review_decision: APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
  linguistic_review_commit: <40 hex>
  linguistic_review_target_sha256: <must equal target_sha256>
  merged: false

secret_safety:
  logs_scanned: true | false
  artifacts_scanned: true | false
  credential_values_found: 0
  authorization_headers_found: 0
```

Разрешённая последовательность live run:

```bash
uv run pytest scripts/gp/tests -q
cd scripts/gp
python upload.py --target frontend --source ../../src/frontend/src/locales/en.json
python upload.py --target backend --source ../../src/backend/base/langflow/locales/en.json
cd ../..
uv run python scripts/gp/check_backend_status.py --lang ru
cd scripts/gp
python download.py --target frontend --lang ru --source ../../src/frontend/src/locales/en.json --output ../../src/frontend/src/locales
python download.py --target backend --lang ru --source ../../src/backend/base/langflow/locales/en.json --output ../../src/backend/base/langflow/locales
```

После download выполнить locale gates из шага 5. Translation PR должен быть создан fine-grained PAT как draft, запрашивать `GP_LINGUISTIC_REVIEWER`, иметь `autoMergeRequest=null` и получить на том же head SHA успешные `CI Success` и `I18n Contract Gates`. Reviewer записывает `APPROVED` для точного target SHA-256; исторический APPROVED другого hash не принимается. Только после этого draft можно вручную перевести в ready-for-review и слить по branch protection.

Если любой обязательный name отсутствует, статус live gate — `BLOCKED`; минимальный unblock — настроить отсутствующие secrets/variables в защищённом `GP-test` environment и повторить весь live run. Нельзя заполнять шаблон synthetic URL/ID, hashes или fictitious PASS.

## Отказ и восстановление

Если download или validation завершается ошибкой, существующие проверенные каталоги остаются источником релизной версии. Не следует вручную подменять отсутствующие строки English fallback ради прохождения gate. Исправление выполняется в GP или source extraction, после чего полный цикл повторяется с шага 3.
