---
description: "Группа пакетов софт-форка Ketos: пакеты, которые форк добавляет поверх upstream-харнеса, хранятся локально и никогда не публикуются в npm."
kind: "package-group"
---

# ketos/：Ketos софт-форк 的包组

[English](README.md) | 中文

## Summary

Группа `ketos` владеет пакетами, которые софт-форк Ketos добавляет поверх upstream DeepSeek Harness. Эти пакеты вплетают специфику Кетоса — брендинг, дефолты, русскую локаль — в те же capability-швы, которые харнес грузит при старте. Публикация запрещена: каждый пакет объявляет `private: true`, релизный гейт считает группу локальным потребителем upstream-пакетов.

## Table of Contents

- [Packages](#packages)
- [Conventions](#conventions)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

В этом этапе ни один пакет Кетоса не вышел; группа легализована до появления первого пакета.

| Package | Роль |
|---|---|

-----

<a id="conventions"></a>
## Conventions

- Имя пакета: `@ketos/<name>`, один пакет на директорию `packages/ketos/<name>/`.
- Каждый манифест объявляет `private: true`; публикация в npm запрещена, workspace-гейт отклоняет всё, что готовит её.
- Тесты живут в собственной директории `tests/` пакета.
- README пакета следует правилам репозитория: `Summary`, а также `Model Experience` и `Known Limitations`, когда пакет меняет модель-видимое поведение или закрепляет пробел.

-----

<a id="related-documentation"></a>
## Related documentation

- [Ketos rebranding plan](../../docs/ketos/stage-00-rebranding.md) — поэтапный план, владеющий этой группой и её констрейнтами (сохранён без перевода).

<a id="dev-note"></a>
## Dev Note

Нет.
