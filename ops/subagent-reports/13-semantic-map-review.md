# Subagent 13 — review семантической карты Ketos ↔ Langflow

Статус: **DONE_WITH_CONCERNS**

## Проверенный артефакт

- `docs/architecture/KETOS_LANGFLOW_SEMANTIC_MAP.md`

## Scope

Изменены только:

- `docs/architecture/KETOS_LANGFLOW_SEMANTIC_MAP.md`;
- `ops/subagent-reports/13-semantic-map-review.md`.

Commit и push не выполнялись.

## Источники

Lineage:

- Langflow `v1.10.2`;
- upstream SHA `a69a47ff1b5c99ce9c50edc4df45de4397151f17`;
- Ketos `HEAD` `572fad8ea2223e342508ecf095133091c7714e1b`;
- merge-base равен upstream SHA;
- Ketos впереди на 70 committed commits.

Навигация:

- `graphify-out/graph.json` для Ketos;
- `references/langflow-upstream/graphify-out/graph.json` для upstream.

Подтверждение:

- текущие исходники Ketos;
- pinned checkout `references/langflow-upstream`;
- rename-aware git diff.

## Review matrix

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| Exact upstream tag/SHA | PASS | `references/langflow-upstream.lock.json` и detached upstream `HEAD` совпадают. |
| Exact merge-base | PASS | `git merge-base HEAD 'v1.10.2^{commit}'` вернул `a69a47ff1b5c99ce9c50edc4df45de4397151f17`. |
| Commits ahead | PASS | `git rev-list --count 'v1.10.2^{commit}..HEAD'` вернул `70`. |
| Оба Graphify-графа использованы | PASS | Выполнены read-only BFS queries для backend/API, frontend/canvas, KFX/LFX/extensions и MCP/agents. |
| Graphify не принят за источник истины | PASS | Все substantive claims имеют парные source anchors либо явно помеченный current-only gap. |
| Backend/API crosswalk | PASS | Сверены `main.py`, `api/router.py`, middleware и route prefixes. |
| Frontend/canvas crosswalk | PASS | Сверены `routes.tsx`, `FlowPage`, `PageComponent`, `flowStore`. |
| Components/flows crosswalk | PASS | Сверены `Component`, class-name ID, `Graph`, `async_start`, `arun`, flow builder. |
| SDK/KFX crosswalk | PASS | Сверены package names, client classes и REST paths. |
| Extensions/bundles crosswalk | PASS | Сверены manifest keys/schema, discovery entry points и DuckDuckGo bundle. |
| Settings/storage crosswalk | PASS | Сверены SettingsService, `config_dir → data_dir`, locale persistence. |
| MCP/agents crosswalk | PASS | Сверены FastMCP server identity/tools и `MCPToolsComponent`. |
| Compatibility crosswalk | PASS | Сверены upstream internal bridge и Ketos compatibility wheels/module maps. |
| Категории присутствуют | PASS | Использованы `переименовано`, `удалено`, `совместимо`, `глубоко переработано`. |
| Mermaid | PASS | Диаграмма отражает lineage, Ketos runtime layers и compatibility boundary. |
| Markdown links/source paths | PASS | Все относительные links разрешаются в существующие файлы; line fragments не выходят за длину источников. |
| Whitespace/fences | PASS | `git diff --no-index --check` не нашёл whitespace errors; Markdown/Mermaid fences сбалансированы. |

## Concerns

1. Upstream Graphify strict gate остаётся `BLOCKED`: dangling/collapsed edges,
   self-loops и 262 не представленных JSON-файла. Это не блокирует source map,
   но запрещает повышать graph-derived выводы до самостоятельного доказательства.
2. В рамках задачи не запускались runtime, unit, frontend или E2E тесты.
   Документ честно ограничен source-level architecture/compatibility map.
3. `BrandStateEngine`, persisted RU/EN locale и fail-closed legacy header guard
   не имеют симметричного upstream implementation anchor; они отмечены как
   current-only deep rework.
4. Compatibility module maps не исполнялись для каждого legacy path. Документ
   не обещает универсальную import compatibility.

## Итог ревью

Карта соответствует pinned lineage, покрывает все запрошенные архитектурные
области, разделяет structural compatibility и intentional cutover, содержит
парные source anchors и не скрывает Graphify/runtime gaps.

Итоговый статус: **DONE_WITH_CONCERNS** — документ готов как
source-confirmed semantic map; concerns относятся к пределам Graphify и
отсутствию runtime certification, а не к отсутствию запрошенных разделов.
