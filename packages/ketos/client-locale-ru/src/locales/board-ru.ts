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
  'canvas.connectorsTitle': 'Инструменты и коннекторы',
  'canvas.messageSent': 'Сообщение отправлено: {message}',
  'rail.agentBadge': 'ИИ',
  'rail.addAgent': 'Добавить карточку агента',
  'rail.addConnectors': 'Коннекторы и инструменты',
  'rail.resetView': 'Центрировать / сбросить холст',
  'inspector.selectTarget': '🎯 Выберите элемент или окно на холсте',
  'menu.attachFile': 'Прикрепить файл',
  'menu.dictate': 'Голосовой ввод',
  'menu.webSearch': 'Веб-поиск',
  'menu.selectElement': 'Выбрать элемент',
  'menu.connectors': 'Инструменты и коннекторы',
  'menu.openActionMenu': 'Открыть меню действий',
  'toolbar.composerPlaceholder': 'Спросите что угодно...',
  'window.close': 'Закрыть',
  'agent.doneBadge': '✓ Готово',
  'agent.learnedCount': 'Изучено: 1',
  'agent.statusReady': 'Автономный агент готов. Инструкции выполнены.',
  'agent.greeting': 'Здравствуйте! Я ваш автономный цифровой ИИ-эксперт. Слежу за корпоративными процессами и готов выполнять рутинные задачи.',
  'agent.composerPlaceholder': 'Спросите агента...',
  'agent.actionMenu': 'Меню действий',
  'agent.contextUsed': 'Использовано {used}K / {max}K контекста',
  'tool.tabConnectors': 'Коннекторы',
  'tool.tabSettings': 'Настройки',
  'tool.connectorsHeading': 'Встроенные коннекторы и инструменты MCP',
  'tool.agentConfigHeading': 'Конфигурация агента',
  'tool.systemPrompt': 'Системный промпт',
  'tool.modelSelection': 'Выбор модели',
  'tool.modelDeepSeekV3': 'DeepSeek-V3 (671B MoE)',
  'tool.modelDeepSeekR1': 'DeepSeek-R1 (Reasoning)',
  'tool.modelLocalVllm': 'Локальный корпоративный vLLM-эндпоинт',
  'tool.defaultSystemPrompt': 'Вы — автономный цифровой ИИ-эксперт платформы Кетос.',
  'tool.coreName': 'Базовые инструменты',
  'tool.coreDesc': 'Чтение, запись, редактирование, bash, субагенты',
  'tool.webSearchName': 'Веб-поиск',
  'tool.webSearchDesc': 'DuckDuckGo / корпоративный поисковый прокси',
  'tool.inspectorName': 'Инспектор браузера',
  'tool.inspectorDesc': 'Захват DOM, выбор элементов',
  'tool.temporalName': 'Оркестрация Temporal',
  'tool.temporalDesc': 'Длительные макропроцессы',
  'tool.mcpName': 'Внешний MCP: Twitter/X',
  'tool.mcpDesc': 'Интеграция чтения и публикации',
} satisfies Record<BoardKey, string>
