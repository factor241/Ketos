# Russian locale: release, rollout и rollback

Этот документ — операционный контракт для выпуска русской локализации. Он не является свидетельством production-развёртывания: **внешний canary не выполнен**, полный rollout не выполнен. Отмечать Stage 11 release acceptance как production PASS можно только после сохранения логов всех трёх topology, метрик canary и репетиции rollback.

## 1. Инварианты и входные данные

- Release строится только из зафиксированного commit SHA и `package-lock.json` через `npm ci`.
- Production package identity — `ketos-base`, component SDK identity — `KFX`; runtime paths и команды используют только current Ketos/KFX names.
- В артефактах обязательны backend raw catalog `ketos/locales/ru.json` и compiled frontend chunk `ketos/frontend/assets/ru-<hash>.js`.
- Формат имени RU chunk: `ru-[A-Za-z0-9_\-]{8,}\.js`.
- System-owned `missing-key = 0`, `fallback = 0`, `failed-loading = 0` — жёсткие release gates, а не допустимые бюджеты ошибок.
- Откат не изменяет сохранённые предпочтения и не удаляет каталоги: **не изменять `preferred_locale`**, **не удалять `ru.json`**.
- Все image references в canary и rollback должны быть digest-pinned. Плавающие `latest`-теги запрещены.

Перед началом:

```bash
set -euo pipefail
cd /Volumes/Projects/ketos_canvas_mod_main

export RELEASE_ID="$(git rev-parse --short=12 HEAD)"
export UNIFIED_IMAGE="ketos-unified:ru-${RELEASE_ID}"
export BACKEND_IMAGE="ketos-backend:ru-${RELEASE_ID}"
export FRONTEND_IMAGE="ketos-frontend:ru-${RELEASE_ID}"
mkdir -p .artifacts/i18n-release

git rev-parse HEAD | tee .artifacts/i18n-release/commit.txt
git status --short | tee .artifacts/i18n-release/worktree.txt
```

Dirty worktree допустим только для локальной проверки. Публикуемый артефакт строится CI из commit, а его digest записывается в `.artifacts/i18n-release/`.

## 2. Общие pre-release gates

Команды из controlling plan выполняются до сборки image:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
make format_frontend_check

cd src/frontend
npm ci
npx tsc --noEmit --pretty --project tsconfig.json
npm run build
npx playwright test \
  tests/core/features/localization-russian-routes.spec.ts \
  tests/core/features/localization-russian-errors.spec.ts \
  --project=chromium
cd ../..

uv run pytest -q \
  scripts/i18n/tests/test_packaging_contract.py \
  scripts/i18n/tests/test_release_runbook_contract.py
make unit_tests async=false
make kfx_tests
make tests_frontend
```

`npm run type-check` не заменяет отдельный `npx tsc --noEmit`: в этом snapshot он включает дополнительный Vite-stage и имеет независимый baseline debt.

Проверка production frontend artifact:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
uv run python - <<'PY'
from __future__ import annotations

import re
from pathlib import Path

assets = Path("src/frontend/build/assets")
chunks = sorted(assets.glob("ru-*.js"))
assert len(chunks) == 1, [str(path) for path in chunks]
assert re.fullmatch(r"ru-[A-Za-z0-9_\-]{8,}\.js", chunks[0].name), chunks[0].name
assert any("Рус" in line for line in chunks[0].read_text(encoding="utf-8").splitlines())
print(chunks[0])
PY

RU_SOURCE_SHA="$(shasum -a 256 src/frontend/src/locales/ru.json | awk '{print $1}')"
RU_ASSET="$(find src/frontend/build/assets -maxdepth 1 -type f -name 'ru-*.js' -print -quit)"
RU_ASSET_SHA="$(shasum -a 256 "${RU_ASSET}" | awk '{print $1}')"
printf '%s  %s\n%s  %s\n' \
  "${RU_SOURCE_SHA}" src/frontend/src/locales/ru.json \
  "${RU_ASSET_SHA}" "${RU_ASSET}" \
  | tee .artifacts/i18n-release/frontend-ru-sha256.txt
```

Если это не первый RU release, CI получает `PREVIOUS_RU_SOURCE_SHA` и `PREVIOUS_RU_ASSET_NAME` из предыдущего attestation. При изменении source catalog имя chunk обязано измениться:

```bash
CURRENT_RU_ASSET_NAME="$(basename "${RU_ASSET}")"
if [[ -n "${PREVIOUS_RU_SOURCE_SHA:-}" && "${RU_SOURCE_SHA}" != "${PREVIOUS_RU_SOURCE_SHA}" ]]; then
  test -n "${PREVIOUS_RU_ASSET_NAME:-}"
  test "${CURRENT_RU_ASSET_NAME}" != "${PREVIOUS_RU_ASSET_NAME}"
fi
```

Для первого RU release текущие source hash, asset name и asset hash становятся baseline следующего релиза.

## 3. Единый runtime smoke helper

Следующая функция реально открывает production UI, выбирает русский язык, перезагружает страницу, проверяет DOM, диагностический bridge, hashed RU chunk и API-заголовки. Она используется без изменений для каждой topology.

```bash
smoke_ru_ui() {
  local base_url="$1"
  (
    cd /Volumes/Projects/ketos_canvas_mod_main/src/frontend
    SMOKE_BASE_URL="${base_url}" node --input-type=module <<'NODE'
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL.replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: "ru-RU" });
  await page.goto(`${baseUrl}/settings/language`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="settings-language-page"]').waitFor({ timeout: 60_000 });

  if ((await page.locator("html").getAttribute("lang")) !== "ru") {
    await page.locator('[data-testid="language-preference-select"]').click();
    await page.getByRole("option", { name: "Русский", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === "ru");
  }

  await page.evaluate(() => window.__KETOS_I18N_DIAGNOSTICS__?.reset());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="settings-language-page"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.lang === "ru");

  const result = await page.evaluate(() => ({
    body: document.body.innerText,
    diagnostics: window.__KETOS_I18N_DIAGNOSTICS__?.snapshot(),
    heading: document.querySelector('[data-testid="settings-language-heading"]')?.textContent?.trim(),
    ruAssets: performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => /\/assets\/ru-[A-Za-z0-9_-]{8,}\.js(?:\?|$)/.test(url)),
  }));
  if (result.heading !== "Язык") throw new Error(`unexpected heading: ${result.heading}`);
  if (!result.body.includes("Русский") || result.body.includes("�")) throw new Error("invalid Russian UI text");
  if (!result.diagnostics) throw new Error("missing i18n diagnostics bridge");
  for (const bucket of ["missing", "failedLoading", "fallback"]) {
    if (result.diagnostics[bucket].length !== 0) {
      throw new Error(`${bucket}: ${JSON.stringify(result.diagnostics[bucket])}`);
    }
  }
  if (result.ruAssets.length === 0) throw new Error("hashed RU chunk was not loaded");

  const apiResponse = await page.request.get(`${baseUrl}/api/v1/config`, {
    headers: { "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.1" },
  });
  if (!apiResponse.ok()) throw new Error(`config HTTP ${apiResponse.status()}`);
  const headers = apiResponse.headers();
  if (headers["content-language"] !== "ru") throw new Error(`Content-Language=${headers["content-language"]}`);
  const vary = (headers.vary ?? "").split(",").map((value) => value.trim().toLowerCase());
  if (!vary.includes("accept-language")) throw new Error(`Vary=${headers.vary}`);
} finally {
  await browser.close();
}
NODE
  )
}
```

## 4. Unified Python package/static SPA

Build и artifact proof:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
docker build --pull --rm \
  -f docker/build_and_push.Dockerfile \
  -t "${UNIFIED_IMAGE}" .

docker run --rm -i --entrypoint python "${UNIFIED_IMAGE}" - <<'PY'
from __future__ import annotations

import re
from importlib.resources import files

root = files("ketos")
assert root.joinpath("locales", "ru.json").is_file()
assets = root.joinpath("frontend", "assets")
chunks = [entry for entry in assets.iterdir() if re.fullmatch(r"ru-[A-Za-z0-9_\-]{8,}\.js", entry.name)]
assert len(chunks) == 1, [entry.name for entry in chunks]
print(chunks[0])
PY

docker image inspect "${UNIFIED_IMAGE}" --format '{{.Id}}' \
  | tee .artifacts/i18n-release/unified-local-image-id.txt
```

До публикации локальный image доказывается через immutable `.Id`: у ещё не
отправленного тега `RepoDigests` обычно пуст. Registry digest для canary
фиксируется только после `docker push`, как показано в разделе 7.

Run и strict RU smoke:

```bash
unified_smoke_cleanup() {
  docker rm -f "ketos-unified-${RELEASE_ID}" >/dev/null 2>&1 || true
}
trap unified_smoke_cleanup EXIT

docker rm -f "ketos-unified-${RELEASE_ID}" 2>/dev/null || true
docker run -d --name "ketos-unified-${RELEASE_ID}" \
  -p 7860:7860 \
  -e KETOS_AUTO_LOGIN=true \
  -e KETOS_SUPERUSER=ketos \
  -e KETOS_SUPERUSER_PASSWORD=ru-smoke-only-password \
  -e KETOS_DATABASE_URL=sqlite:////app/ketos/ru-smoke.db \
  -e KETOS_CONFIG_DIR=/app/ketos \
  "${UNIFIED_IMAGE}"

for _ in $(seq 1 120); do
  curl -fsS http://127.0.0.1:7860/health_check >/dev/null && break
  sleep 1
done
curl -fsS http://127.0.0.1:7860/health_check
smoke_ru_ui http://127.0.0.1:7860
docker logs "ketos-unified-${RELEASE_ID}" \
  > .artifacts/i18n-release/unified.log 2>&1
unified_smoke_cleanup
trap - EXIT
```

## 5. Standalone frontend Nginx + backend

Build images:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
docker build --pull --rm \
  -f docker/build_and_push_backend.Dockerfile \
  -t "${BACKEND_IMAGE}" .
docker build --pull --rm \
  -f docker/frontend/build_and_push_frontend.Dockerfile \
  -t "${FRONTEND_IMAGE}" .

# Standalone frontend builder intentionally pins the exact release toolchain:
# node:22.14.0-bookworm-slim. `scripts/i18n/tests/test_packaging_contract.py`
# blocks floating `node:lts` regressions.

docker run --rm -i --entrypoint python "${BACKEND_IMAGE}" - <<'PY'
from importlib.resources import files

assert files("ketos").joinpath("locales", "ru.json").is_file()
PY
docker run --rm --entrypoint sh "${FRONTEND_IMAGE}" -c \
  'test "$(find /usr/share/nginx/html/assets -maxdepth 1 -type f -name "ru-*.js" | wc -l)" -eq 1'
```

Run через Nginx proxy:

```bash
standalone_smoke_cleanup() {
  docker rm -f "ketos-frontend-${RELEASE_ID}" "ketos-backend-${RELEASE_ID}" >/dev/null 2>&1 || true
  docker network rm "ketos-ru-${RELEASE_ID}" >/dev/null 2>&1 || true
}
trap standalone_smoke_cleanup EXIT

docker rm -f "ketos-frontend-${RELEASE_ID}" "ketos-backend-${RELEASE_ID}" 2>/dev/null || true
docker network rm "ketos-ru-${RELEASE_ID}" 2>/dev/null || true
docker network create "ketos-ru-${RELEASE_ID}"

docker run -d --name "ketos-backend-${RELEASE_ID}" \
  --network "ketos-ru-${RELEASE_ID}" \
  -e KETOS_AUTO_LOGIN=true \
  -e KETOS_SUPERUSER=ketos \
  -e KETOS_SUPERUSER_PASSWORD=ru-smoke-only-password \
  -e KETOS_DATABASE_URL=sqlite:////app/ketos/ru-smoke.db \
  -e KETOS_CONFIG_DIR=/app/ketos \
  "${BACKEND_IMAGE}"

docker run -d --name "ketos-frontend-${RELEASE_ID}" \
  --network "ketos-ru-${RELEASE_ID}" \
  -p 3000:8080 \
  -e FRONTEND_PORT=8080 \
  -e BACKEND_URL="http://ketos-backend-${RELEASE_ID}:7860" \
  "${FRONTEND_IMAGE}"

for _ in $(seq 1 120); do
  curl -fsS http://127.0.0.1:3000/health_check >/dev/null && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/health_check
smoke_ru_ui http://127.0.0.1:3000
```

### Content-Language и Vary через proxy

Проверка выполняется на proxy URL, не напрямую на backend:

```bash
curl -fsS -D .artifacts/i18n-release/standalone-api-headers.txt \
  -o /dev/null \
  -H 'Accept-Language: ru-RU,ru;q=0.9,en;q=0.1' \
  http://127.0.0.1:3000/api/v1/config

uv run python - <<'PY'
from pathlib import Path

lines = Path(".artifacts/i18n-release/standalone-api-headers.txt").read_text(encoding="utf-8").splitlines()
headers: dict[str, list[str]] = {}
for line in lines:
    if ":" not in line:
        continue
    name, value = line.split(":", 1)
    headers.setdefault(name.strip().lower(), []).append(value.strip())
assert headers.get("content-language") == ["ru"], headers
vary = {token.strip().lower() for value in headers.get("vary", []) for token in value.split(",")}
assert "accept-language" in vary, headers
PY
```

### Cache-Control и locale cache busting

```bash
RU_ASSET_NAME="$(basename "${RU_ASSET}")"
curl -fsSI "http://127.0.0.1:3000/assets/${RU_ASSET_NAME}" \
  | tee .artifacts/i18n-release/standalone-ru-asset-headers.txt
curl -fsSI http://127.0.0.1:3000/index.html \
  | tee .artifacts/i18n-release/standalone-index-headers.txt

uv run python - <<'PY'
from pathlib import Path

asset = Path(".artifacts/i18n-release/standalone-ru-asset-headers.txt").read_text().lower()
index = Path(".artifacts/i18n-release/standalone-index-headers.txt").read_text().lower()
assert "cache-control:" in asset and "public" in asset and "max-age=" in asset
assert "cache-control:" in index and "no-cache" in index and "no-store" in index
PY

docker logs "ketos-backend-${RELEASE_ID}" > .artifacts/i18n-release/standalone-backend.log 2>&1
docker logs "ketos-frontend-${RELEASE_ID}" > .artifacts/i18n-release/standalone-frontend.log 2>&1
standalone_smoke_cleanup
trap - EXIT
```

`index.html` остаётся revalidatable/no-store, а hashed locale asset кэшируется. При изменении `ru.json` новый HTML/main chunk ссылается на новое content-addressed имя; старый RU chunk не перезаписывается под тем же URL.

## 6. Wheel installation smoke

Wheel собирается только после копирования production SPA в package tree:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
make build_frontend
rm -rf .artifacts/i18n-release/wheel-dist .artifacts/i18n-release/wheel-venv
uv build --package ketos-base --wheel \
  --out-dir .artifacts/i18n-release/wheel-dist \
  --clear

WHEEL="$(find .artifacts/i18n-release/wheel-dist -maxdepth 1 -type f -name 'ketos_base-*.whl' -print -quit)"
test -n "${WHEEL}"
uv run python - "${WHEEL}" <<'PY'
from __future__ import annotations

import re
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    names = archive.namelist()
assert "ketos/locales/ru.json" in names
assert len([name for name in names if re.fullmatch(r"ketos/frontend/assets/ru-[A-Za-z0-9_\-]{8,}\.js", name)]) == 1
PY

uv venv --python 3.12 .artifacts/i18n-release/wheel-venv
uv pip install \
  --python .artifacts/i18n-release/wheel-venv/bin/python \
  "${WHEEL}"

WHEEL_PID=""
wheel_smoke_cleanup() {
  if [[ -n "${WHEEL_PID:-}" ]]; then
    kill "${WHEEL_PID}" >/dev/null 2>&1 || true
    wait "${WHEEL_PID}" >/dev/null 2>&1 || true
  fi
}
trap wheel_smoke_cleanup EXIT

KETOS_AUTO_LOGIN=true \
KETOS_SUPERUSER=ketos \
KETOS_SUPERUSER_PASSWORD=ru-smoke-only-password \
KETOS_DATABASE_URL="sqlite:////Volumes/Projects/ketos_canvas_mod_main/.artifacts/i18n-release/wheel.db" \
KETOS_CONFIG_DIR="/Volumes/Projects/ketos_canvas_mod_main/.artifacts/i18n-release/wheel-config" \
  .artifacts/i18n-release/wheel-venv/bin/ketos-base run \
  --host 127.0.0.1 --port 7861 \
  > .artifacts/i18n-release/wheel-server.log 2>&1 &
WHEEL_PID=$!

for _ in $(seq 1 120); do
  curl -fsS http://127.0.0.1:7861/health_check >/dev/null && break
  sleep 1
done
curl -fsS http://127.0.0.1:7861/health_check
smoke_ru_ui http://127.0.0.1:7861
wheel_smoke_cleanup
trap - EXIT
```

PASS требует и ZIP proof, и запуск из чистого venv. Проверка wheel только через исходное дерево не считается installation smoke.

## 7. Canary: метрики, пороги и этапы

До начала canary dashboard должен различать RU cohort и контрольный EN cohort, release digest и topology. Метрики ниже — обязательный semantic contract; если production telemetry ещё не экспортирует их, canary заблокирован до подключения exporter/synthetic job.

Машиночитаемый жёсткий контракт нулевых бюджетов находится в
`docs/localization/ru/r11-zero-budget-metrics.json`. Он требует нулевых
`missing_key`, `fallback`, `locale_load_failure` и `unknown_error_code` как по
числу событий, так и по rate. Для каждой canary-ступени копируется
`docs/localization/ru/r11-canary-evidence.template.json`; исходный статус
`BLOCKED_NOT_EXECUTED` намеренно не является PASS и не должен заменяться без
реального deployment, dashboard export и synthetic evidence.

После заполнения evidence проверяется исполняемым gate:

```bash
uv run python scripts/i18n/check_r11_release_evidence.py --evidence \
  .artifacts/i18n-release/canary-1-percent.json
```

Валидатор требует full release SHA, clean CI checkout, exact enabled и rollback
registry digests, topology, cohort, observation window, положительный sample
count и ссылки на dashboard/synthetic artifacts. Любое ненулевое значение
локализационной метрики блокирует promotion.

Canary-ссылка становится digest-pinned только после успешной публикации:

```bash
: "${CANARY_REGISTRY_REPOSITORY:?set registry repository without tag}"
CANARY_UNIFIED_IMAGE="${CANARY_REGISTRY_REPOSITORY}:ru-${RELEASE_ID}"
docker tag "${UNIFIED_IMAGE}" "${CANARY_UNIFIED_IMAGE}"
docker push "${CANARY_UNIFIED_IMAGE}"
export DIGEST_REPOSITORY="${CANARY_REGISTRY_REPOSITORY}"
docker image inspect "${CANARY_UNIFIED_IMAGE}" --format '{{json .RepoDigests}}' \
  | uv run python -c '
import json, os, sys
repository = os.environ["DIGEST_REPOSITORY"]
matches = [item for item in json.load(sys.stdin) if item.startswith(f"{repository}@")]
assert len(matches) == 1, matches
print(matches[0])
' | tee .artifacts/i18n-release/unified-registry-digest.txt
test -s .artifacts/i18n-release/unified-registry-digest.txt
```

В deployment и canary inventory используется значение из
`unified-registry-digest.txt`, а не локальный tag или `.Id`.

| Сигнал | Источник | Порог остановки/rollback |
|---|---|---|
| system missing key | `__KETOS_I18N_DIAGNOSTICS__.snapshot().missing` в synthetic route matrix | любое событие; `missing-key = 0` |
| system English fallback | `.fallback` в synthetic route matrix | любое событие; `fallback = 0` |
| RU bundle load failure | `.failedLoading`, CDN/Nginx status для текущего RU asset | любое событие; `locale_load_failure = 0` |
| неизвестный stable error code | frontend API error resolver unknown-code counter | любое событие; `unknown_error_code = 0` |
| locale header mismatch | `Accept-Language: ru` при `Content-Language != ru` или без `Vary: Accept-Language` | любое synthetic событие |
| locale preference PATCH failure | `/api/v1/users/{id}` для RU cohort | >0.5% за 10 минут при >=100 попытках |
| frontend uncaught errors | RUM, RU против EN той же версии | RU > EN на 0.25 п.п. или >1.5x за 10 минут при >=500 sessions |
| API 5xx | proxy/backend metrics, RU против EN | RU > EN на 0.25 п.п. или >1.5x за 10 минут |
| API p95 | `/api/v1/config`, types/flow endpoints | >20% против EN baseline 15 минут подряд |
| UI route success | release synthetic по manifest | <100% одного полного прогона |

Продвижение идёт только digest-to-digest:

1. 0%: artifact, header, strict diagnostics и rollback-candidate smoke.
2. 1% internal cohort, минимум 30 минут и 500 sessions/100 language changes.
3. 5%, минимум 60 минут.
4. 25%, минимум 2 часа.
5. 50%, минимум 4 часа.
6. 100% только после 24 часов без нарушения порогов на предыдущей ступени.

На каждой ступени сохранить dashboard export, exact image digests, время окна и результат route synthetic. Любой жёсткий i18n gate останавливает продвижение немедленно; service guardrail требует rollback, если сохраняется два последовательных evaluation window.

## 8. Rollback без потери preference и каталогов

### 8.1 Предыдущий совместимый digest

Единственный rollback-механизм — переключение deployment на **предыдущий совместимый digest** приложения. Его выбирают из release inventory до canary. Он обязан быть совместим с уже применённой схемой БД, поддерживать обязательные локали `en` и `ru` и ранее пройти те же topology, artifact и runtime gates. Во время инцидента rollback artifact не собирают и не публикуют заново.

Откат не меняет данные пользователя и не чистит locale assets: не выполнять downgrade миграции, не изменять `preferred_locale`, не удалять `ru.json` или hashed RU chunk и не очищать `ketos-language-preference`.

Digest принимается только в immutable registry-форме `repository@sha256:<64 hex>`:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
set -euo pipefail

: "${PREVIOUS_COMPATIBLE_DIGEST:?set previous compatible registry digest}"
export PREVIOUS_COMPATIBLE_DIGEST
uv run python - <<'PY'
import os
import re

digest = os.environ["PREVIOUS_COMPATIBLE_DIGEST"]
assert re.fullmatch(r".+@sha256:[0-9a-f]{64}", digest), digest
PY

printf '%s\n' "${PREVIOUS_COMPATIBLE_DIGEST}" \
  | tee .artifacts/i18n-release/previous-compatible-registry-digest.txt
test -s .artifacts/i18n-release/previous-compatible-registry-digest.txt
docker pull "${PREVIOUS_COMPATIBLE_DIGEST}"

export EXPECTED_ROLLBACK_DIGEST="${PREVIOUS_COMPATIBLE_DIGEST}"
docker image inspect "${PREVIOUS_COMPATIBLE_DIGEST}" --format '{{json .RepoDigests}}' \
  | uv run python -c '
import json, os, sys
digests = json.load(sys.stdin)
expected = os.environ["EXPECTED_ROLLBACK_DIGEST"]
assert expected in digests, (expected, digests)
'
```

Release evidence должно ссылаться на `previous-compatible-registry-digest.txt` и на attestation предыдущего релиза. Локальный tag, `.Id` или digest артефакта из другого repository не принимается.

### 8.2 Исполняемая репетиция current → previous-compatible → current

Репетиция ниже использует один named volume для SQLite DB/config на всех трёх
фазах и один Playwright `storageState` для browser localStorage. Между фазами
меняется только digest; volume не удаляется. `trap` всегда удаляет контейнер и
volume, но сохраняет JSON evidence вне volume. Это доказывает совместимость
предыдущего релиза с текущими данными без мутации preference.

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
set -euo pipefail

ROLLBACK_CONTAINER="ketos-ru-rehearsal-${RELEASE_ID}"
ROLLBACK_DATA_VOLUME="ketos-ru-rehearsal-${RELEASE_ID}"
ROLLBACK_BASE_URL="http://127.0.0.1:7862"
ROLLBACK_EVIDENCE_DIR="/Volumes/Projects/ketos_canvas_mod_main/.artifacts/i18n-release/rollback-rehearsal"
ROLLBACK_STATE_PATH="${ROLLBACK_EVIDENCE_DIR}/browser-state.json"
mkdir -p "${ROLLBACK_EVIDENCE_DIR}"
rm -f "${ROLLBACK_STATE_PATH}" "${ROLLBACK_EVIDENCE_DIR}"/*.json

rollback_rehearsal_cleanup() {
  local status=$?
  docker rm -f "${ROLLBACK_CONTAINER}" >/dev/null 2>&1 || true
  docker volume rm "${ROLLBACK_DATA_VOLUME}" >/dev/null 2>&1 || true
  return "${status}"
}
trap rollback_rehearsal_cleanup EXIT

docker volume create "${ROLLBACK_DATA_VOLUME}" >/dev/null

start_rollback_rehearsal() {
  local image="$1"
  docker rm -f "${ROLLBACK_CONTAINER}" >/dev/null 2>&1 || true
  docker run -d --name "${ROLLBACK_CONTAINER}" \
    -p 7862:7860 \
    -v "${ROLLBACK_DATA_VOLUME}:/app/ketos" \
    -e KETOS_AUTO_LOGIN=true \
    -e KETOS_SUPERUSER=ketos \
    -e KETOS_SUPERUSER_PASSWORD=ru-rehearsal-only-password \
    -e KETOS_DATABASE_URL=sqlite:////app/ketos/rollback-rehearsal.db \
    -e KETOS_CONFIG_DIR=/app/ketos \
    "${image}" >/dev/null

  for _ in $(seq 1 120); do
    curl -fsS "${ROLLBACK_BASE_URL}/health_check" >/dev/null && return 0
    sleep 1
  done
  docker logs "${ROLLBACK_CONTAINER}" >&2
  return 1
}

rollback_rehearsal_assert() {
  (
    cd /Volumes/Projects/ketos_canvas_mod_main/src/frontend
    ROLLBACK_STATE_PATH="${ROLLBACK_STATE_PATH}" \
    ROLLBACK_EVIDENCE_DIR="${ROLLBACK_EVIDENCE_DIR}" \
    ROLLBACK_PHASE="${ROLLBACK_PHASE}" \
    EXPECTED_LANG="${EXPECTED_LANG}" \
    EXPECTED_RU_OPTION_COUNT="${EXPECTED_RU_OPTION_COUNT}" \
      node --input-type=module <<'NODE'
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.ROLLBACK_BASE_URL;
const statePath = process.env.ROLLBACK_STATE_PATH;
const evidenceDir = process.env.ROLLBACK_EVIDENCE_DIR;
const phase = process.env.ROLLBACK_PHASE;
const expectedLang = process.env.EXPECTED_LANG;
const expectedRuOptionCount = Number(process.env.EXPECTED_RU_OPTION_COUNT);
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(existsSync(statePath) ? { storageState: statePath } : {}),
  });
  const page = await context.newPage();
  const preferencePatchRequests = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/api\/v1\/users\//.test(request.url())) {
      preferencePatchRequests.push(request.url());
    }
  });

  await page.goto(`${baseUrl}/settings/language`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="settings-language-page"]').waitFor({ timeout: 60_000 });

  const selector = page.locator('[data-testid="language-preference-select"]');
  await selector.click();
  const ruOption = page.getByRole("option", { name: "Русский", exact: true });
  const ruOptionCount = await ruOption.count();
  if (ruOptionCount !== expectedRuOptionCount) {
    throw new Error(`${phase}: RU option count ${ruOptionCount}`);
  }

  const currentLang = await page.locator("html").getAttribute("lang");
  if (phase === "current-before" && currentLang !== "ru") {
    const preferenceWrite = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /\/api\/v1\/users\//.test(response.url()) &&
        response.ok(),
    );
    await ruOption.click();
    await preferenceWrite;
    await page.waitForFunction(() => document.documentElement.lang === "ru");
  } else {
    await page.keyboard.press("Escape");
  }

  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    expectedLang,
  );
  const profileResponse = await page.request.get(`${baseUrl}/api/v1/users/whoami`);
  if (!profileResponse.ok()) throw new Error(`${phase}: whoami HTTP ${profileResponse.status()}`);
  const profile = await profileResponse.json();
  if (profile.preferred_locale !== "ru") {
    throw new Error(`${phase}: preferred_locale=${profile.preferred_locale}`);
  }

  const uiState = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    storedPreference: localStorage.getItem("ketos-language-preference"),
  }));
  if (uiState.storedPreference !== "ru") {
    throw new Error(`${phase}: raw localStorage preference changed: ${JSON.stringify(uiState)}`);
  }
  if (phase !== "current-before" && preferencePatchRequests.length !== 0) {
    throw new Error(`${phase}: unexpected profile mutation ${JSON.stringify(preferencePatchRequests)}`);
  }

  const evidence = { phase, profile, uiState, ruOptionCount, preferencePatchRequests };
  writeFileSync(join(evidenceDir, `${phase}.json`), JSON.stringify(evidence, null, 2));
  await context.storageState({ path: statePath });
  await context.close();
} finally {
  await browser.close();
}
NODE
  )
}

start_rollback_rehearsal "${UNIFIED_IMAGE}"
ROLLBACK_PHASE="current-before" EXPECTED_LANG="ru" EXPECTED_RU_OPTION_COUNT="1" rollback_rehearsal_assert

start_rollback_rehearsal "${PREVIOUS_COMPATIBLE_DIGEST}"
ROLLBACK_PHASE="previous-compatible" EXPECTED_LANG="ru" EXPECTED_RU_OPTION_COUNT="1" rollback_rehearsal_assert

start_rollback_rehearsal "${UNIFIED_IMAGE}"
ROLLBACK_PHASE="current-after" EXPECTED_LANG="ru" EXPECTED_RU_OPTION_COUNT="1" rollback_rehearsal_assert

uv run python - <<'PY'
import json
from pathlib import Path

root = Path(".artifacts/i18n-release/rollback-rehearsal")
current_before = json.loads((root / "current-before.json").read_text())
previous = json.loads((root / "previous-compatible.json").read_text())
current_after = json.loads((root / "current-after.json").read_text())

phases = (current_before, previous, current_after)
assert len({phase["profile"]["id"] for phase in phases}) == 1
assert [phase["profile"]["preferred_locale"] for phase in phases] == ["ru", "ru", "ru"]
assert [phase["uiState"]["lang"] for phase in phases] == ["ru", "ru", "ru"]
assert [phase["uiState"]["storedPreference"] for phase in phases] == ["ru", "ru", "ru"]
assert previous["preferencePatchRequests"] == []
assert current_after["preferencePatchRequests"] == []
PY
```

Фаза `current-before` единственная при необходимости выбирает RU и создаёт
исходный preference. Фазы `previous-compatible` и `current-after` не отправляют
PATCH: один профиль остаётся `ru`, `ketos-language-preference` остаётся `ru`, а
обе версии показывают RU без мутации БД.

### 8.3 Граница wheel topology

Wheel installation smoke из раздела 6 остаётся обязательным release gate, но
wheel не является production rollback-механизмом. Откат выполняется только на
зафиксированный `PREVIOUS_COMPATIBLE_DIGEST`; пересборка wheel или image во
время инцидента запрещена.

### 8.4 Аварийная последовательность

1. Остановить promotion и зафиксировать время/нарушенный порог.
2. Сверить `PREVIOUS_COMPATIBLE_DIGEST` с release inventory и attestation.
3. Переключить deployment на **предыдущий совместимый digest**. Не пересобирать image или wheel во время инцидента.
4. Инвалидировать только HTML/entry manifest и CDN routing metadata. Hashed RU asset не удалять; он безопасно истечёт по TTL.
5. Не выполнять downgrade миграции, которая удаляет `preferred_locale`; не запускать массовый `UPDATE ... preferred_locale='en'` и не очищать `ketos-language-preference`.
6. Повторить `/health_check`, proxy header check, RU/EN route smoke и контроль сохранности RU preferences.
7. Держать release остановленным до root-cause и нового digest с полным набором gates.

После rollback сравнить количество RU preferences до/после через approved read-only database telemetry; оно не должно уменьшиться из-за процедуры. Повторное включение RU выполняется как новый canary с первой ступени, а не прямым возвратом на 100%.

## 9. Release evidence и статус

### 9.1 Текущий статус evidence

Исторические доказательства иной rollback-стратегии не принимаются для этого
контракта. Нужна свежая репетиция `current → previous-compatible → current` с
точным registry digest, общей БД/browser state и неизменными preference.

Для итогового PASS приложить:

- [ ] commit SHA и clean CI checkout;
- [ ] local `.Id` текущего rehearsal image, release registry digest и `PREVIOUS_COMPATIBLE_DIGEST`;
- [ ] frontend/wheel/image artifact listings с backend raw catalog и compiled frontend RU chunk;
- [ ] stdout общих gates и трёх runtime smoke;
- [ ] proxy `Content-Language`/`Vary` headers;
- [ ] locale asset и `index.html` cache headers;
- [ ] canary dashboard export каждой ступени;
- [ ] неизменность `preferred_locale` после репетиции rollback;
- [ ] подтверждение, что backend `ketos/locales/ru.json` и compiled frontend `ru-<hash>.js` остались в rollback artifacts.

Пока эти внешние evidence не приложены, корректный статус: **runbook READY; production canary/rollout/rollback rehearsal NOT EXECUTED**.
