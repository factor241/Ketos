# Граница русской локализации Langflow

Этот документ фиксирует, какие строки принадлежат системе и обязаны иметь семантический ключ, а какие должны оставаться неизменными. Он применяется к frontend, backend metadata, встроенным шаблонам, accessibility-текстам, ошибкам и расширениям.

## Зафиксированный baseline

- Git root: `/Volumes/Projects/ketos_canvas_mod_main`.
- Branch: `main`.
- HEAD: `def832f409c01f0acd3937b9317dde03d0273552`.
- Исходный `git status --short --branch`:

  ```text
  ## main...origin/main
  ?? FRONTEND_ARCHITECTURE_AUDIT.md
  ?? LANGFLOW_BACKEND_ARCHITECTURE_AUDIT.md
  ?? LANGFLOW_RUSSIAN_LOCALIZATION_PLAN.md
  ?? graphify-out/
  ```

- Frontend source catalog: 7 locale-файлов по 2 068 ключей; `ru.json` отсутствовал.
- Backend source catalog: `en.json` — 6 781 ключ; шесть target locales — по 6 761 ключу; `ru.json` отсутствовал.
- Существующие пользовательские untracked-артефакты не относятся к реализации и сохраняются без изменений: архитектурные аудиты, план и `graphify-out/`.
- Baseline tests: frontend 3 suites / 16 tests PASS; backend 51 tests PASS с одним известным Starlette deprecation warning.

## Решающее правило

Строка переводится, если Langflow владеет её смыслом и показывает её пользователю как часть продукта. Строка остаётся verbatim, если она принадлежит пользователю, внешнему провайдеру, машинному контракту или диагностическому payload. Сомнительная строка не попадает в allowlist автоматически: владелец поверхности обязан классифицировать её и оставить проверяемое обоснование.

## Классы текста

| Класс | Переводить | Примеры | Правило реализации |
|---|---|---|---|
| `system` | Да | заголовки, кнопки, placeholders, empty/loading/error states, уведомления | семантический ключ сначала в английском source-каталоге, затем во всех shipped locales |
| `accessibility` | Да | `aria-label`, `aria-description`, `title`, `alt`, `sr-only` | тот же контракт полноты, что и для видимого UI; translated text не используется как test id |
| `backend_metadata` | Да | display name/description/input/output labels встроенных компонентов, starter flows, system notes с `i18n_key` | локализуется только presentation field; `name`, method, type и raw value неизменны |
| `user` | Нет | названия сценариев, custom labels, prompts, code, имена файлов, пользовательские заметки | показывать verbatim; локализация wrapper UI не изменяет содержимое |
| `protocol` | Нет | route, API field, enum, event/status/type, query/cache key, UUID, model ID | byte-identical во frontend, backend, сохранённом Flow JSON и transport |
| `brand` | Обычно нет | Langflow, GitHub, Discord, названия моделей и провайдеров | точное brand name может быть allowlisted; окружающее предложение переводится |
| `extension` | По ownership | bundled extension UI либо имеет namespaced `ru` bundle, либо получает явную untranslated policy | extension не может перекрывать core namespace; user extension без bundle остаётся verbatim |
| `diagnostic` | Нет по умолчанию | traceback, provider error, log, raw payload, `technical_detail` | не выдавать как системный локализованный message; показывать только в явном diagnostics UI |

## Неизменяемые машинные контракты

Запрещено переводить или строить из перевода:

- Python component class names;
- component/input/output `name`;
- methods и type identifiers;
- route paths, API fields и enum values;
- SSE, NDJSON, WebSocket, OpenAI и MCP event/status/type;
- React Query keys, cache keys, DOM handle IDs и `data-testid`;
- option `value`, provider/model IDs и environment-variable names;
- node IDs, edge IDs, serialized Flow JSON и persisted session identifiers.

Локализованный option label хранится отдельно от stable value. Сопоставление outputs выполняется по stable `output.name`, а не по переведённой подписи и не по позиции. Переключение `en → ru → en` не должно менять ни один из перечисленных контрактов.

## Frontend

Ключ обязателен для JSXText, visible attributes, placeholders, tooltips, badges, menu items, table columns, validation/help text, alert/toast content, dialog chrome и статического HTML. `index.html` должен получать корректный `lang`; `<title>Langflow</title>` является точным brand name, но `noscript`-текст переводится.

Пользовательские данные и raw provider output не передаются в `t()` как ключи. Динамические предложения системы строятся из семантического ключа и typed params. Интерполяционные tokens и numeric `<Trans>` tags сохраняются точно.

Raw scan является только генератором кандидатов. TypeScript signatures, generic arrows, JSX tag syntax, semantic translation keys и другие машинные конструкции должны получать отдельные dispositions `false_positive_scanner`, `machine_contract` или `already_semantic_key`; их запрещено автоматически превращать в translation debt.

## Backend metadata и встроенный контент

Переводимыми являются только явно перечисленные presentation fields встроенных ресурсов. На baseline это `display_name`, `description`, `info`, `placeholder` и output presentation fields; дальнейшее расширение schema должно явно добавить `helper_text`, `refresh_button_text`, `list_add_label`, `auth_tooltip`, `min_label`, `max_label`, `trigger_text` и option labels.

Raw option value, prompt/value content и custom component text не переводятся. Starter note переводится только при наличии стабильного `i18n_key`. Общий English component cache не мутируется: locale применяется к копии ответа, а locale-dependent caches разделяются.

## Ошибки

Native UI error обязан иметь стабильные `code` и `params`. Frontend сначала разрешает `code` в semantic key; английский `message` остаётся compatibility fallback. `technical_detail`, traceback и `str(exc)` не становятся системным переводом. Unknown code получает локализованный generic wrapper, а raw detail доступен только как явно обозначенная диагностика.

## Protected tokens

Внутри переводимого предложения без изменения сохраняются: `Langflow`, `API`, `MCP`, `LLM`, `JSON`, `YAML`, `CSV`, `SQL`, `SSE`, `WebSocket`, `UUID`, `OAuth`, `URL`, `GitHub`, `Discord`, имена провайдеров/моделей, code identifiers и расширения файлов. Protected token не освобождает всё предложение от перевода.

## Allowlist policy

Allowlist применяется только к точному совпадению `path + value`. Wildcard paths, регулярные выражения широкого действия и exemptions уровня каталога запрещены. Каждая запись содержит `reason`, `owner` и `review_date`. System-owned English debt не маскируется allowlist: он остаётся blocking candidate и закрепляется за соответствующей migration wave.

## Воспроизведение baseline scan

Raw baseline строится четырьмя узкими эвристиками, затем дедуплицируется по полной строке `path:line:source`:

```bash
prod_globs=(--glob '*.{ts,tsx,js,jsx}' --glob '!**/__tests__/**' --glob '!**/*.test.*' --glob '!**/*.spec.*' --glob '!**/*.stories.*' --glob '!**/__mocks__/**' --glob '!**/testUtils/**' --glob '!**/components/examples/**' --glob '!**/icons/**')
{
  rg -n --pcre2 '>\s*[A-Za-z][^<{\n]*\s*<' src/frontend/src "${prod_globs[@]}"
  rg -n --pcre2 '(?:aria-label|title|placeholder|alt|label|description|tooltip|headerName|emptyMessage|buttonText|helperText|caption)\s*=\s*\x22[A-Za-z][^\x22\n]*\x22' src/frontend/src "${prod_globs[@]}"
  rg -n --pcre2 '(?:title|placeholder|label|description|tooltip|headerName|message|content|buttonText|text)\s*:\s*\x22[A-Za-z][^\x22\n]*\x22' src/frontend/src "${prod_globs[@]}"
  rg -n --pcre2 'return\s+(?:\x22|`)[A-Z][A-Za-z][^\x22`\n]*(?:\x22|`)' src/frontend/src "${prod_globs[@]}"
} | LC_ALL=C sort -u | awk -F: '{lines++; files[$1]=1} END {for (f in files) n++; print lines, n}'
```

Ожидаемый результат на baseline HEAD: `239 94`.

AST baseline использует фактически установленный TypeScript compiler API `5.9.3` (package constraint `^5.4.5`), production `*.ts`/`*.tsx`, исключает tests/mocks/stories/locales и считает alphabetic JSXText плюс literal visible attributes `title`, `placeholder`, `aria-label`, `alt`, `label`, `description`, `tooltip`, `headerName`, `emptyMessage`, `buttonText`, `helperText`, `caption`. Полный machine-readable predicate, exclusions, patterns и ожидаемые counts находятся в `scan_contract` файла `scripts/i18n/allowlists/frontend-hardcoded.json`; на baseline ожидаются 1 397 файлов, 201 JSXText и 21 visible attribute.

Статический `src/frontend/index.html` проверяется отдельным `static_html_inventory`: runtime `lang` принадлежит Task 4, точный brand title allowlisted, а `<noscript>` является system-owned debt Task 9. Эти строки не входят в исторический raw count `239/94`, область которого — `src/frontend/src`.

Outside-modal overlay inventory строится отдельным source pass по production `*.ts`/`*.tsx`: Radix `Dialog`/`Popover`/`DropdownMenu`/`ContextMenu`, custom `createPortal`, `role="dialog"` и feature-owned listbox/menu implementations. Повторные tooltip-only usages покрываются shared primitives, но каждый feature popover/menu/dialog имеет собственную строку manifest; независимые состояния одного source (например, два Flow Insights dialogs и deploy-choice phases) перечисляются отдельно. На baseline manifest содержит 57 overlay-state строк и 5 shared primitive строк.

## Ownership и review

- Frontend shell/pages/components: `frontend-localization`.
- Backend metadata/middleware/errors: `backend-localization`.
- Protocol/ABI: `platform-contracts`.
- Bundled extensions: владелец extension и `localization-governance`.
- Лингвистический review: `ru-linguistic-reviewer` по glossary и screenshot matrix.

Reviewer проверяет не только JSON, но и реальный RU DOM, accessibility tree, tooltips, error states, persisted-flow round trip и artifacts. Решение фиксируется в `docs/localization/ru/linguistic-review.md`.

## STOP-условия

Этап немедленно получает FAIL, если перевод меняет stable identifier/value/protocol, затирает user-owned text, мутирует English cache, допускает system-owned fallback в strict RU, отправляет locale header на arbitrary external origin, позволяет extension подменить core namespace или скрывает реальный English debt allowlist/CSS-обходом.
