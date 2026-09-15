---
description: "Ketos 语言包：完整的俄语 UI 词典（44 个命名空间）、浏览器请求俄语时生效的 ru 默认值，以及社区包的署名与同步流程。"
kind: "package-reference"
---

# @ketos/client-locale-ru

[English](README.md) | 中文

## 概述

Ketos 以俄语作为界面语言，同时不重命名 locale 机制、也不覆盖用户的显式选择。客户端插件注册 `ru` 语言（回退 `en`），并翻译完整的 Ketos UI 词典——MIT 许可的社区 [`deepseek-harness-locale-ru`](https://github.com/warment/deepseek-harness-locale-ru) 包，已改名为 Ketos 并补齐 Ketos 语料新增的键，另加 `common` 与 `board`。未存储偏好且浏览器请求带 `ru` 标签的语言时，它仅执行一次活动 locale 切换到 `ru`。命名了随附 `zh`/`en` 链或未注册语言的浏览器保持常规回退；已保存的选择永不被覆盖。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

**Runtime invariant:** 无已发布的 companion。本包通过 locale 服务（`addLanguage`、词典注册）和一个 settings-scope 观察器注册；disposal 移除语言与词典，这在 locale 目录上可观察。

`ketos` CLI 的 web 配置通过客户端插件名册加载本包，无需任何配置；激活顺序让插件位于 `locale` 行之后，因此语言服务与其 scope 在插件运行时已经就位。内置权限预设标签由所属客户端包的词典本地化（`displayPermissionPreset`），因此基座机器 id 表保持不变，各语言渲染各自的名称——此处为 `Запись в рабочей папке`。已注册的特性照常通过共享查找读取俄语文案：各特性命名空间经共享链解析，`common` 的 `brand.localBuild` 为 `Кетос`，`board` 命名空间则以俄语覆盖画布、停靠栏、Omnibox 与窗口文案。插件在本地镜像 locale 命名空间与偏好字段常量（对 locale 包只做类型导入），以保持客户端打包纯净。

词典是生成产物：`scripts/sync-dictionaries.mjs` 合并社区包、fork 语料与 `scripts/dictionary-overrides.json`（改名覆盖项，以及社区包未覆盖键的人工翻译）生成 `src/locales/{common-ru,pack-ru}.ts`，并写出键清单 `tests/fixtures/ru-keys.json` 供包测试校验覆盖率。移植的社区内容继续遵循其 MIT 许可；上游版权声明保留在 `LICENSE-locale-ru`。

-----

<a id="model-experience"></a>
## 模型体验

无模型体验：本语言包只做客户端 UI，不注册任何工具、提示词段落或会话事件，其文案从不进入模型请求。

#### KV Cache 效果

无效果；`ru` 默认值在启动时写入的那一条设置项（浏览器请求俄语且未存偏好时的 `locale: { preference: ru }`）是宿主侧持久状态，UI 显示的俄语文案来自已注册的词典。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 语料反映生成时 fork 的客户端键集；之后上游新增的键会回退到英文，直到用社区提取器与 `scripts/sync-dictionaries.mjs` 重新同步。
- 当浏览器请求俄语且已保存文档最初没有偏好时，`ru` 默认值通过常规写路径写入 `locale: { preference: ru }`；全新 home 因此在首次使用后记录该选择，而以 `en` 命名的浏览器保持英文。

### 开发备注

刷新语料时，在本仓库根目录运行社区包的 `scripts/extract.mjs`（它通过 `tsx` 导入客户端 locale 模块并生成 `corpus.json`），然后重新生成词典：

```sh
node --import tsx/esm <locale-ru>/scripts/extract.mjs --root "$PWD" --out /tmp/ketos-corpus
node packages/ketos/client-locale-ru/scripts/sync-dictionaries.mjs --corpus /tmp/ketos-corpus/corpus.json --community <locale-ru>/dict/ru
```
