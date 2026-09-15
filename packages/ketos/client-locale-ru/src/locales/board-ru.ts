/**
 * Russian dictionary for the `board` namespace: one translated entry per key
 * of the Board package's en dictionary, with `{placeholder}` templates kept
 * verbatim. The `satisfies` check pins the key set to the board package's
 * export; the import is type-only, so the client bundle stays pure.
 */
import type { BoardKey } from '@deepseek-ai/dsh-client-ui-board/src/client/locale.ts'

/** Dictionary registered into `board` for the Ketos canvas, rail, and windows. */
export const ru = {
  'sidebar.panel': 'Доска',
  'canvas.agentTitle': 'Агент №{n}',
  'canvas.agentStatusOnline': 'Цифровой ИИ-эксперт подключён.',
  'rail.agentBadge': 'ИИ',
  'rail.addAgent': 'Добавить карточку агента',
  'rail.resetView': 'Центрировать / сбросить холст',
  'inspector.selectTarget': 'Выберите элемент или окно на холсте',
  'inspector.cancel': 'Отменить выбор',
  'menu.attachFile': 'Прикрепить файл',
  'menu.dictate': 'Голосовой ввод',
  'menu.webSearch': 'Веб-поиск',
  'menu.selectElement': 'Выбрать элемент',
  'menu.openActionMenu': 'Открыть меню действий',
  'menu.send': 'Отправить',
  'toolbar.composerPlaceholder': 'Спросите что угодно...',
  'window.close': 'Закрыть',
  'agent.doneBadge': '✓ Готово',
  'agent.learnedCount': 'Изучено: 1',
  'agent.statusReady': 'Автономный агент готов. Инструкции выполнены.',
  'agent.greeting': 'Здравствуйте! Я ваш автономный цифровой ИИ-эксперт. Слежу за корпоративными процессами и готов выполнять рутинные задачи.',
  'agent.composerPlaceholder': 'Спросите агента...',
  'agent.actionMenu': 'Меню действий',
  'agent.contextUsed': 'Использовано {used}K / {max}K контекста',
} satisfies Record<BoardKey, string>
