---
description: "Языковой пакет Кетоса для веб-интерфейса: русская локаль, её общий и settings-словари и выбор ru по умолчанию, пока пользователь не сохранил собственную локаль."
kind: "package-reference"
---

# @ketos/client-locale-ru

[English](README.md) | 中文

## 概述

Кетос 以俄语作为界面的默认语言，同时不重命名 locale 机制、也不覆盖用户的显式选择。客户端插件向共享语言目录注册 `ru` 语言（回退 `en`），翻译 `common` 与 `settings.locale` 命名空间，并只执行一次 `ru` 作为活动语言的切换——且仅在 `locale` 设置命名空间没有 `preference` 时生效。已保存的选择（例如 `en`）由 locale 服务的 scope 订阅负责采用，本插件不会覆盖它。

## 目录

- [使用本包](#use-this-package)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`ketos` CLI 的 web 配置通过客户端插件名册加载本包，不需要任何配置；激活顺序让插件位于 `locale` 行之后，因此语言服务与其 scope 在插件运行时已经就位。已注册的特性照常通过共享查找读取俄语文案：各特性命名空间经共享链解析，`common` 现在携带全部翻译键，包括 `brand.localBuild` 的 `Локальная сборка Кетос`。插件在本地镜像 locale 命名空间与偏好字段常量（对 locale 包只做类型导入），以保持客户端打包纯净。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- 词典目前覆盖 `common` 与 `settings.locale`；其余客户端特性的命名空间词典经 `ru → en` 退化链解析，这些界面保持英文文案，直到各自拥有者开设 per-feature 的 `ru` 词典。
- 当已保存文档最初没有偏好时，`ru` 默认值通过常规写路径写入 `locale: { preference: ru }`；全新 home 因此在首次使用后记录该选择。

<a id="dev-note"></a>
## 开发备注

无。
