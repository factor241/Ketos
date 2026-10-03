# Ketos: CI форка factor241/Ketos

Репозиторий форка публичный, поэтому стандартные GitHub-раннеры бесплатны. Апстримные workflow рассчитаны на enterprise-раннеры организации и секреты апстрима: в форке они отключены (где GitHub их регистрирует), записаны со статусом (где ещё не зарегистрированы), либо заменены одним собственным workflow. Журнал расхождений с апстримом — [`upstream-sync.md`](upstream-sync.md), решение — Agent Note [`2026-10-03-ketos-fork-ci.md`](../../.agents/notes/implemented/process/2026-10-03-ketos-fork-ci.md).

## Что запускается

| Workflow | Триггеры | Содержание |
|---|---|---|
| ketos-ci, задание `linux / node 24` (`ketos-ci.yml`) | push в `main`, pull_request в `main`, workflow_dispatch | `ubuntu-24.04`, Node 24: `pnpm install --frozen-lockfile`, `scripts/prepare-ci-bubblewrap.sh`, `build`, `typecheck`, `lint`, `test:gui`, `doc-sync`, `hygiene`, `DSH_SNAPSHOT=replay pnpm run test:web:built`. Обязательный Linux-сигнал для PR и `main`. |
| ketos-ci, задание `linux / node 24 / coverage` (`ketos-ci.yml`) | schedule `23 3 * * *` (ежедневно), workflow_dispatch | `pnpm run test:coverage` — порог 100% по файлам; на pull request не запускается. |
| E2E (real DeepSeek API) (`e2e.yml`) | push в `main`, pull_request, schedule `17 0 * * *`, workflow_dispatch | `pnpm run test:e2e` против внешнего DeepSeek API. Без секрета `DEEPSEEK_API_KEY_EXTERNAL` preflight печатает warning, real-API сценарии самопропускаются. |
| Node Addon System (`node-addon-system.yml`) | pull request и push по путям `native/system/**` | Матрица платформенных сборок на стандартных раннерах; обычных PR не касается. |
| Expected filenames (`expected-filenames.yml`) | pull request по путям с `golden` в имени файла | Запрет golden-имён; обычных PR не касается. |

Параллелизм `ketos-ci` рассчитан на 4 vCPU раннера `ubuntu-24.04`: `DSH_GATE_CONCURRENCY=4`, `DSH_OXLINT_THREADS=4`, `DSH_PUBLINT_CONCURRENCY=4`, `DSH_SNAPSHOT_MAX_CONCURRENCY=4`, `DSH_COVERAGE_MAX_WORKERS=4` — по строке 4-core консолидированной топологии `ci-master.yml`.

## Инфраструктурные workflow: статус

| Workflow | Файл | Почему не работает в форке | Статус |
|---|---|---|---|
| CI | `ci.yml` | Linux- и Windows-задания закреплены на enterprise-раннеры `dsh-ubuntu-24-04-16core` / `dsh-windows-2025-16core`; в форке этих раннеров нет — вечная очередь | отключён |
| CI master | `ci-master.yml` | Триггер push в `master` (в форке основная ветка `main`) и self-hosted-пулы `[self-hosted, linux, x64, vm-backup]`, `[self-hosted, dsh-win-ci, windows]` | не зарегистрирован GitHub; не срабатывает на PR/push `main` |
| Build PR preview | `build-preview-cloudflare.yml` | Нет секретов и проекта Cloudflare (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`) | отключён |
| Release (dsh) | `release.yml` | Релизная последовательность апстрима; в форке падала на pack/verify-layout (задача ketos-cbn.1, п. 5–6) | отключён |
| Release publish (dsh) | `release-publish.yml` | Публикация в npm из окружения `npm-publish` с `NPM_TOKEN` | не зарегистрирован GitHub; только `workflow_dispatch` |
| Release (vendor) | `release-vendor.yml` | Релиз вендоренного фреймворка апстрима | отключён |
| Release publish (vendor) | `release-vendor-publish.yml` | Окружение `npm-publish` + `NPM_TOKEN` | не зарегистрирован GitHub; только `workflow_dispatch` |
| Release (Python) | `python-release.yml` | Окружения `pypi` / `pypi-runtime` с OIDC и релизными тегами | не зарегистрирован GitHub; только `workflow_dispatch` |
| Node Addon System Release | `node-addon-system-release.yml` | Окружение `npm-publish` + `NPM_TOKEN` | не зарегистрирован GitHub; только `workflow_dispatch` |
| Build single-exe | `build-exe-for-python-sdk.yml` | Reusable-workflow для отключённых вызывающих; требует `DEEPSEEK_API_KEY_EXTERNAL` и релизные артефакты | не зарегистрирован GitHub; вызывается только отключёнными workflow |
| Issue policy | `issue-policy.yml` | GitHub App (`DSH_ISSUE_APP_PRIVATE_KEY`, `vars.DSH_ISSUE_APP_CLIENT_ID`) и Projects организации `deepseek-harness` | отключён |
| Issue lifecycle | `issue-lifecycle.yml` | Тот же App-токен и доска Projects апстрима | отключён |
| weighted-approval | `weighted-approval.yml` | Политика review-ownership апстрима пишет коммит-статусы; зависит от парного workflow ниже | отключён |
| weighted-approval-review-event | `weighted-approval-review-event.yml` | Регистратор событий ревью для `weighted-approval`; безвредный echo | не зарегистрирован GitHub; срабатывает только на review-событие |
| E2E (pi-ai Azure OpenAI and Anthropic) | `pi-ai-provider-e2e.yml` | Секреты `AZURE_OPENAI_API_KEY_EXTERNAL`, `ANTHROPIC_API_KEY_EXTERNAL` | не зарегистрирован GitHub; только `workflow_dispatch` |
| E2E (E2B sandbox) | `e2b-e2e.yml` | Секрет `E2B_API_KEY_EXTERNAL` | не зарегистрирован GitHub; только `workflow_dispatch` |
| Deploy documentation | `docs-pages.yml` | Окружение `github-pages` с tag-политикой и обязательными ревьюерами апстрима | не зарегистрирован GitHub; только `workflow_dispatch` |
| Sandbox | `sandbox.yml` | Триггер только push в `master`; в форке не срабатывает | не зарегистрирован GitHub; не срабатывает на PR/push `main` |

`gh workflow disable <файл>.yml -R factor241/Ketos` отключает workflow, зарегистрированные в реестре GitHub Actions: отключены 7 из 18. Остальные 11 файлов GitHub ещё не зарегистрировал на `main` (реестр сохранил набор из ранней истории репозитория), поэтому `disable` отвечает 404, а их триггеры не срабатывают на pull request и push в `main`; как только workflow появится в реестре, он отключается той же командой. Отключение обратимо: `gh workflow enable <файл>.yml -R factor241/Ketos`; файлы workflow при этом не меняются.

## Ключ DeepSeek

```sh
gh secret set DEEPSEEK_API_KEY_EXTERNAL -R factor241/Ketos
```

Workflow `e2e.yml` читает именно `DEEPSEEK_API_KEY_EXTERNAL` (и маппит его в `DEEPSEEK_API_KEY`, который читают тесты). Без ключа E2E остаётся зелёным с самопропуском real-API сценариев; после добавления ключа ежедневные, push- и PR-запуски выполняют реальные вызовы.

## Что не покрыто в форке

Windows-полоса и wine-гейты из `ci-master.yml` (нужен запуск `pnpm run check:windows-wine` локально), Python-runtime матрица, benchmarks, self-hosted standby, публикация релизов. Апстримные `ci.yml` и `ci-master.yml` не изменяются — они остаются точкой отсчёта для будущих приёмок upstream.
