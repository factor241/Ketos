# Style guide русской локализации Langflow

Правила применяются к frontend, accessibility text, backend presentation metadata, встроенным шаблонам с `i18n_key` и native error messages. Нормативные термины берутся из `glossary.md`, границы ownership — из `translation-boundary.md`.

## Тон и обращение

- Тон нейтральный, спокойный и предметный.
- Не использовать гендерно-зависимые формы: «готов/готова», «вы выбрали/выбрала».
- По возможности не обращаться к пользователю напрямую. Предпочитать «Выберите модель» вместо «Вы можете выбрать модель».
- Для инструкций допустима вежливая форма второго лица множественного числа: «Введите имя», «Проверьте подключение».
- Не добавлять эмоциональные оценки, маркетинговые усилители и восклицательные знаки, которых нет в source meaning.
- Пользовательский текст, raw provider output и diagnostics не перефразировать и не исправлять.

## Компоненты интерфейса

### Кнопки и пункты меню

- Использовать короткий глагол совершенного действия: «Создать», «Сохранить», «Удалить», «Повторить».
- Не ставить точку и двоеточие.
- Сохранять различия `Удалить`, `Убрать`, `Отмена`, `Закрыть` из glossary.
- Для destructive confirmation последняя кнопка называет действие и объект: «Удалить сценарий», а не «Да».
- `Next` в пошаговой форме — «Далее»; `Continue` после паузы — «Продолжить».

### Labels, headings, badges

- Label — существительное или короткая именная группа без точки: «Имя сценария», «Провайдер моделей».
- Heading использует sentence case: «Настройки базы знаний», не Title Case.
- Badge отражает состояние кратко: «Устаревший», «Рекомендуется», «Развёрнуто».
- Единицы измерения и protected abbreviations сохраняют утверждённый регистр.

### Descriptions, help и empty states

- Description — полное предложение с точкой.
- Help text объясняет последствие или следующий шаг, а не повторяет label.
- Empty state сообщает, что отсутствует, и при необходимости предлагает действие: «Сценариев пока нет. Создайте первый сценарий.»
- Placeholder подсказывает формат или ожидаемое значение, но не заменяет label.
- Machine-format examples (`https://…`, `sk-…`, `vector_field`) остаются verbatim.

### Loading и progress

- Для незавершённого процесса использовать существительное с многоточием: «Загрузка…», «Сохранение…».
- Использовать единый символ многоточия `…`, не три точки `...`, кроме точного machine example (`AIza...`).
- Не обещать успешный результат до завершения операции.

## Ошибки, предупреждения и подтверждения

- Пользовательская ошибка состоит из краткого результата и полезного следующего шага: «Не удалось сохранить сценарий. Повторите попытку.»
- Native UI error разрешается по стабильному `code` и typed `params`. English `message` — только compatibility fallback.
- `technical_detail`, traceback, `str(exc)`, provider error и raw payload не вставляются в локализованное системное предложение.
- Unknown code показывает нейтральный локализованный wrapper; диагностика доступна отдельно и явно помечена.
- Не обвинять пользователя: «Значение не поддерживается», а не «Вы ввели неверное значение».
- Confirmation называет объект и необратимое последствие. Destructive action не маскируется общей кнопкой «Продолжить».
- Warning описывает риск до действия; success toast кратко подтверждает завершённое действие.

Примеры:

| Тип | Правильно | Неправильно |
|---|---|---|
| Ошибка | «Не удалось загрузить файл. Повторите попытку.» | «Error: provider request failed» |
| Validation | «Введите имя сценария.» | «Invalid value» |
| Confirmation | «Удалить сценарий „Анализ“? Это действие нельзя отменить.» | «Вы уверены?» |
| Success | «Сценарий сохранён.» | «Успешно!!!» |

Имя пользовательского объекта в confirmation показывается verbatim и не передаётся как translation key.

## Русская типографика

- Кавычки в prose: «ёлочки»; вложенные — „лапки“.
- Между частями предложения использовать длинное тире `—` с пробелами. Дефис `-` применяется внутри сложных слов и protected tokens (`API-ключ`).
- Использовать неразрывный пробел между числом и единицей, если renderer это поддерживает: `10 МБ`.
- Не ставить пробел перед `, . : ; ? !`; после знака ставить один пробел.
- В UI использовать `ё` там, где нормативное написание содержит её или без неё меняется чтение: «развёртывание», «сохранён», «учётная запись».
- Сокращения использовать только общеупотребительные или защищённые glossary tokens; не создавать локальные аббревиатуры ради экономии места.
- Labels и headings не заканчиваются точкой; полные descriptions/errors заканчиваются точкой.
- В локализованном prose использовать русские кавычки, но не менять ASCII quotes внутри code, JSON, CLI и identifiers.

## Числа, даты и сортировка

- Presentation formatting получает locale из единого registry, а не из browser default.
- Для `ru-RU`: десятичная запятая, локализованные разделители тысяч и русские названия месяцев.
- ISO timestamps, persisted values, query params и payloads не форматируются и не переводятся.
- Presentation sorting использует активную locale; machine ordering и serialized graph не меняются.
- Relative time формируется locale-aware API, не конкатенацией переведённых фрагментов.

## Plural forms

Русский каталог обязан иметь `one`, `few`, `many`, `other` для plural-групп. Проверяются как минимум `0, 1, 2, 5, 11, 21, 22, 25, 101` через `Intl.PluralRules("ru")`.

Не собирать фразу из отдельных translated fragments. Весь шаблон хранится одним semantic key:

```json
{
  "items_one": "{{count}} элемент",
  "items_few": "{{count}} элемента",
  "items_many": "{{count}} элементов",
  "items_other": "{{count}} элемента"
}
```

## Interpolation, markup и Markdown

- Имена interpolation tokens сохраняются byte-identical: `{{count}}`, `{{name}}`.
- Numeric `<Trans>` tags сохраняются с теми же номерами и парностью: `<0>…</0>`.
- HTML tag names/attributes, Markdown link targets и code fences не переводятся.
- Переводчик может менять порядок tokens для естественного русского, но не добавляет и не удаляет tokens.
- Не помещать пользовательский текст, raw provider response или diagnostics в `t()` как key.
- Dynamic keys разрешены только через узкий documented allowlist и проверяемый namespace.

## Accessibility

- `aria-label`, `aria-description`, `title`, `alt`, tooltip и `sr-only` переводятся наравне с видимым текстом.
- Accessible name описывает действие: «Закрыть диалог», «Удалить версию», а не имя иконки `X`/`Trash2`.
- Не использовать translated text как `data-testid`, DOM id, React key или persisted value.
- Смена языка должна обновлять уже открытые accessible names без reload.
- CSS truncation/скрытие не считается исправлением непереведённого или переполняющегося текста.

## Backend metadata и встроенный контент

- Переводятся только presentation fields, перечисленные metadata contract: display labels, descriptions, help и placeholders.
- `name`, method, type, output name, option value и raw component value остаются стабильными.
- Built-in note переводится только при наличии стабильного `i18n_key`; пользовательская note показывается verbatim.
- Source English cache не мутируется; locale применяется к копии, а locale-dependent cache разделяется.
- Extension bundle использует собственный namespace и не может перекрывать core keys.

## Protected terms в предложении

Имя защищается, предложение переводится:

- `Connect to GitHub` → «Подключиться к GitHub».
- `OpenSearch requires an index_name` → «Для OpenSearch требуется `index_name`».
- `Invalid MCP JSON` → «Некорректный JSON MCP».

Не переводить provider/model/client names и technical link labels. Список — в `glossary.md`; hardcoded exception требует точного reviewed allowlist entry.

## Контроль качества перед sign-off

Reviewer проверяет:

1. термин соответствует glossary, forbidden variant отсутствует;
2. tone нейтрален, gender-dependent form отсутствует;
3. buttons/labels/descriptions/errors оформлены по типу;
4. protected tokens, interpolation, tags и links сохранены;
5. plural categories полны;
6. user/protocol/diagnostic text не изменён;
7. visible DOM, accessibility tree, tooltip/toast и static HTML не содержат unallowlisted English;
8. RU и pseudo screenshots не скрывают переполнение;
9. `en → ru → en` не меняет machine graph, values и persisted data.

Результат фиксируется в `linguistic-review.md`; без явного `APPROVED` wave остаётся закрытой.
