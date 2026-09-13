/**
 * Russian base dictionary for the common namespace: one translated entry per
 * key of `@deepseek-ai/dsh-client-locale`'s en dictionary, with `{placeholder}`
 * templates kept verbatim. The `satisfies` check pins the key set to en's;
 * the import is type-only, so the client bundle stays pure.
 */
import type { CommonKey } from '@deepseek-ai/dsh-client-locale/client'

export const ru = {
  'ok': 'ОК',
  'cancel': 'Отмена',
  'close': 'Закрыть',
  'copy': 'Копировать',
  'copied': 'Скопировано',
  'copy.failed': 'Не удалось скопировать',
  'copy.value': 'Копировать значение',
  'copy.json': 'Копировать JSON',
  'copy.path': 'Копировать путь свойства',
  'copy.prettyJson': 'Копировать форматированный JSON',
  'copy.compactJson': 'Копировать компактный JSON',
  'copy.optionsHint': '{action}; щёлкните правой кнопкой, чтобы выбрать режим копирования',
  'retry': 'Повторить',
  'loading': 'Загрузка…',
  'load.failed': 'Не удалось загрузить',
  'submit': 'Отправить',
  'submitting': 'Отправка…',
  'next': 'Далее',
  'previous': 'Предыдущая',
  'skip': 'Пропустить',
  'delete': 'Удалить',
  'edit': 'Редактировать',
  'save': 'Сохранить',
  'search': 'Поиск',
  'more': 'Ещё',
  'collapse': 'Свернуть',
  'expand': 'Развернуть',
  'back': 'Назад',
  'brand.localBuild': 'Локальная сборка Кетос',
  'unknown': 'Неизвестно',
  'none': 'Отсутствует',
  'truncated': 'Усечено',
  'json.collapseNode': 'Свернуть узел JSON',
  'json.expandNode': 'Развернуть узел JSON',
  'json.label': 'JSON',
  'markdown.footnotes': 'Сноски',
  'markdown.truncatedCharacters': '… усечено на {total} символах',
  'number.thousand': '{value}К',
  'number.million': '{value}М',
} satisfies Record<CommonKey, string>
