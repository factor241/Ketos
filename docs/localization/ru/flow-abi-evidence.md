# Task 16: доказательства current-only flow localization ABI

Дата проверки: 2026-07-13. Corpus schema: `current`. Reviewer: `platform-contracts`.

## Решение

**APPROVED** для dependency-free current corpus: 4/4 cases PASS. Переключение локали меняет только
presentation metadata; сериализованные node IDs, edge IDs, component types, input/output names и edge handles
остаются неизменными. Исторические compatibility-cases не принимаются и не участвуют в runtime-проверке.

Решение ограничено перечисленным corpus. Provider-backed agent flows, удалённые форматы и внешние network tools
не являются частью current-only acceptance surface.

## Current corpus

Manifest: `tests/fixtures/localization/flow-abi/current/manifest.json`.

| Case | Покрытие | Save/reload | Build/run | Machine diff | Runtime |
|---|---|---:|---:|---:|---:|
| `base-flow` | базовый current text pipeline | PASS | PASS | 0 | equivalent |
| `custom-label-flow` | пользовательские component/field/output labels | PASS | PASS | 0 | equivalent |
| `assistant-modified-flow` | assistant-authored prompt и stable selected output | PASS | PASS | 0 | equivalent |
| `output-reordered-flow` | RU output reorder с разрешением по stable `output.name` | PASS | PASS | 0 | equivalent |

## Проверенные инварианты

- manifest перечисляет каждый и только существующий current fixture;
- fixture использует `source_format_version: current` и не содержит compatibility metadata;
- node IDs и edge IDs уникальны и совпадают с IDs реально собранного графа;
- edge IDs кодируют фактические source/target IDs, output name и target field name;
- component types, template field names, raw option values, output names/methods и selected output стабильны;
- edge source output и target field handles стабильны после локализации и JSON save/reload;
- custom labels и assistant-authored values не переписываются переводом;
- persisted business identifiers не содержат translation/i18n metadata;
- `en -> ru -> en` сохраняет machine projection и runtime result;
- API create/PATCH/GET/delete и `Graph.from_payload` build/run выполняются для каждой case.

## Автоматические тесты

- Frontend: `src/frontend/src/stores/__tests__/flow-localization-abi-regression.test.ts` — current-only cases и
  presentation-boundary regressions.
- Backend corpus contract: `src/backend/tests/integration/test_i18n_flow_abi_corpus_contract.py` — manifest,
  fixture schema, topology-derived handles и stable identifier boundary.
- Backend runtime: `src/backend/tests/integration/test_i18n_flow_abi_runtime.py` — 4/4
  create/save/reload/build/run cases с локальными dependency-free components.
- Rejection matrix: `scripts/ci/test_task16_rejection_matrix.py` — отсутствие удалённых corpus/helper paths и
  dangling references в активных backend/frontend/docs consumers.

Команды доказательства:

```bash
uv run --frozen --no-sync pytest -q scripts/ci/test_task16_rejection_matrix.py
uv run --frozen --no-sync pytest -q \
  src/backend/tests/integration/test_i18n_flow_abi_corpus_contract.py \
  src/backend/tests/integration/test_i18n_flow_abi_runtime.py
```

Runtime-тесты проверяют значения напрямую и не изменяют `.artifacts`.

## Residual

Provider-backed OpenAI/Anthropic/Google agent execution, remote vector stores и network tools остаются отдельным
integration concern. Они не требуются для доказательства, что локализация current Ketos flows не меняет machine ABI.
