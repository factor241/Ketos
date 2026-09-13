/**
 * Russian base dictionary for the `common` namespace: the full ru corpus of
 * the Ketos shell, rebranded from the community `deepseek-harness-locale-ru`
 * pack (MIT; see the package README). The `satisfies` check pins the key set
 * to the owning package's en dictionary; the import is type-only, so the
 * client bundle stays pure.
 */
import type { CommonKey } from '@deepseek-ai/dsh-client-locale/client'

/** Dictionary registered into `locale` for the common namespace. */
export const ru = {
  'back': 'Назад',
  'brand.localBuild': 'Локальная сборка Кетос',
  'cancel': 'Отмена',
  'close': 'Закрыть',
  'collapse': 'Свернуть',
  'copied': 'Скопировано',
  'copy': 'Копировать',
  'copy.compactJson': 'Копировать компактный JSON',
  'copy.failed': 'Не удалось скопировать',
  'copy.json': 'Копировать JSON',
  'copy.optionsHint': '{action}; щёлкните правой кнопкой мыши для вариантов копирования',
  'copy.path': 'Копировать путь свойства',
  'copy.prettyJson': 'Копировать форматированный JSON',
  'copy.value': 'Копировать значение',
  'delete': 'Удалить',
  'edit': 'Изменить',
  'expand': 'Развернуть',
  'json.collapseNode': 'Свернуть узел JSON',
  'json.expandNode': 'Развернуть узел JSON',
  'json.label': 'JSON',
  'load.failed': 'Не удалось загрузить',
  'loading': 'Загрузка…',
  'markdown.footnotes': 'Сноски',
  'markdown.truncatedCharacters': '… усечено до {total} символов',
  'more': 'Ещё',
  'next': 'Далее',
  'none': 'Нет',
  'number.million': '{value}М',
  'number.thousand': '{value}К',
  'ok': 'ОК',
  'previous': 'Назад',
  'retry': 'Повторить',
  'save': 'Сохранить',
  'search': 'Поиск',
  'skip': 'Пропустить',
  'submit': 'Отправить',
  'submitting': 'Отправка…',
  'truncated': 'Усечено',
  'unknown': 'Неизвестно',
} satisfies Record<CommonKey, string>
