# R9: flow localization ABI evidence

Дата проверки: 2026-07-12. Corpus schema: `v1`. Reviewer: `platform-contracts`.

## Решение

**APPROVED** для всего созданного dependency-free corpus: 6/6 cases PASS. Normalized machine graph diff, user override diff, business identifier diff и runtime mismatch равны нулю. Production-код в R9 не изменялся.

Это решение ограничено перечисленным corpus. External/provider-backed agent flows не запускались без credentials и network dependency; для них статус `NOT_RUN` и residual concern, а не подразумеваемый PASS.

## Versioned corpus

Manifest: `tests/fixtures/localization/flow-abi/v1/manifest.json`.

| Case | Покрытие | Save/reload | Build/run | Machine diff | Runtime |
|---|---|---:|---:|---:|---:|
| `old-flow` | source format 0.6 | PASS | PASS | 0 | equivalent |
| `outdated-flow` | outdated + replacement metadata | PASS | PASS | 0 | equivalent |
| `legacy-flow` | legacy + removed-output metadata | PASS | PASS | 0 | equivalent |
| `custom-label-flow` | component/field/output user labels | PASS | PASS | 0 | equivalent |
| `assistant-modified-flow` | assistant-modified prompt + stable selected output | PASS | PASS | 0 | equivalent |
| `output-reordered-flow` | RU output reorder matched by stable `output.name` | PASS | PASS | 0 | equivalent |

## Проверенные инварианты

- node IDs, edge IDs и component types;
- template field names и raw option values;
- output names, methods и selected output;
- edge source output и target field handles;
- custom labels и assistant-authored values;
- `legacy`/`replacement` compatibility metadata;
- отсутствие translation/i18n metadata в persisted business identifiers;
- `en -> ru -> JSON save/reload -> en` на frontend;
- API create/PATCH/GET/delete и `Graph.from_payload` build/run на backend для каждой case.

## Автоматические тесты

- Frontend: `src/frontend/src/stores/__tests__/flow-localization-abi-regression.test.ts` — 1 suite, 9 tests PASS; шесть parameterized v1 cases плюс три targeted legacy regressions.
- Backend corpus contract: `src/backend/tests/integration/test_i18n_flow_abi_corpus_contract.py` — manifest completeness, fixture schema, stable identifier boundary.
- Backend runtime: `src/backend/tests/integration/test_i18n_flow_abi_runtime.py` — 6/6 create/save/reload/build/run cases с локальными dependency-free components.

Команды доказательства:

```bash
cd src/frontend
npm test -- --runInBand src/stores/__tests__/flow-localization-abi-regression.test.ts

cd src/backend
uv run pytest tests/integration/test_i18n_flow_abi_corpus_contract.py tests/integration/test_i18n_flow_abi_runtime.py -q
```

## Machine artifacts

Root: `.artifacts/localization/ru/r9-flow-abi/`.

Для каждой case сохранены:

- `<case>/machine-diff.json` — normalized graph, user override и business identifier hashes; `changes=[]` при PASS;
- `<case>/runtime-result.json` — результаты фаз `en`, `ru`, `en`, save/reload и build/run status.

Aggregate: `.artifacts/localization/ru/r9-flow-abi/summary.json`.

## Residual

Provider-backed OpenAI/Anthropic/Google agent execution, remote vector stores и network tools не входят в созданный corpus и не запускались. Локализация не должна требовать provider calls, поэтому R9 platform ABI approval основан на полностью выполненном dependency-free corpus; provider runtime остаётся отдельным integration concern.
