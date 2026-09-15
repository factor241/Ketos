/** Board-owned locale namespace and dictionaries. */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Namespace for Board canvas, rail, omnibox, inspector, and window copy. */
export const NS = 'board'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'sidebar.panel': '看板',
  'canvas.agentTitle': '代理 #{n}',
  'canvas.agentStatusOnline': '自主 AI 专家分身已上线。',
  'rail.agentBadge': 'AI',
  'rail.addAgent': '添加代理卡片',
  'rail.resetView': '居中 / 重置画布',
  'inspector.selectTarget': '在画布上选择一个元素或窗口',
  'inspector.cancel': '取消选择',
  'menu.attachFile': '附加文件',
  'menu.dictate': '语音输入',
  'menu.webSearch': '网页搜索',
  'menu.selectElement': '选择元素',
  'menu.openActionMenu': '打开操作菜单',
  'menu.send': '发送',
  'toolbar.composerPlaceholder': '随便问点什么...',
  'window.close': '关闭',
  'agent.doneBadge': '✓ 完成',
  'agent.learnedCount': '已学习 1 条',
  'agent.statusReady': '自主代理就绪。指令已执行。',
  'agent.greeting': '你好！我是你的自主 AI 专家分身。正在监控企业工作流，随时可以执行常规任务。',
  'agent.composerPlaceholder': '向代理提问...',
  'agent.actionMenu': '操作菜单',
  'agent.contextUsed': '已使用 {used}K / {max}K 上下文',
} satisfies Record<string, string>

/** Board dictionary key union. */
export type BoardKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The spatial board panel's canvas, rail, omnibox, and window copy. */
    board: BoardKey
  }
}

/** The `t` seat type of the Board registration. */
export type BoardTranslate = TranslateNS<'board'>

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'sidebar.panel': 'Board',
  'canvas.agentTitle': 'Agent #{n}',
  'canvas.agentStatusOnline': 'Autonomous AI Expert twin online.',
  'rail.agentBadge': 'AI',
  'rail.addAgent': 'Add Agent Card',
  'rail.resetView': 'Center / Reset Canvas',
  'inspector.selectTarget': 'Select an element or window on the canvas',
  'inspector.cancel': 'Cancel selection',
  'menu.attachFile': 'Attach file',
  'menu.dictate': 'Dictate',
  'menu.webSearch': 'Web search',
  'menu.selectElement': 'Select an element',
  'menu.openActionMenu': 'Open Action Menu',
  'menu.send': 'Send',
  'toolbar.composerPlaceholder': 'Ask me anything...',
  'window.close': 'Close',
  'agent.doneBadge': '✓ Done',
  'agent.learnedCount': '1 learned',
  'agent.statusReady': 'Autonomous Agent ready. Instructions executed.',
  'agent.greeting': 'Hello! I am your autonomous AI expert twin. I am monitoring corporate workflows and ready to execute routine tasks.',
  'agent.composerPlaceholder': 'Ask agent anything...',
  'agent.actionMenu': 'Action Menu',
  'agent.contextUsed': '{used}K / {max}K context used',
} satisfies Record<BoardKey, string>
