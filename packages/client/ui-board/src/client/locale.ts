/** Board-owned locale namespace and dictionaries. */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Namespace for Board canvas, rail, omnibox, inspector, and window copy. */
export const NS = 'board'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'sidebar.panel': '看板',
  'canvas.agentTitle': '代理 #{n}',
  'canvas.agentStatusOnline': '自主 AI 专家分身已上线。',
  'canvas.connectorsTitle': '工具与连接器',
  'canvas.messageSent': '消息已发送：{message}',
  'rail.agentBadge': 'AI',
  'rail.addAgent': '添加代理卡片',
  'rail.addConnectors': '连接器与工具',
  'rail.resetView': '居中 / 重置画布',
  'inspector.selectTarget': '🎯 在画布上选择一个元素或窗口',
  'menu.attachFile': '附加文件',
  'menu.dictate': '语音输入',
  'menu.webSearch': '网页搜索',
  'menu.selectElement': '选择元素',
  'menu.connectors': '工具与连接器',
  'menu.openActionMenu': '打开操作菜单',
  'toolbar.composerPlaceholder': '随便问点什么...',
  'window.close': '关闭',
  'agent.doneBadge': '✓ 完成',
  'agent.learnedCount': '已学习 1 条',
  'agent.statusReady': '自主代理就绪。指令已执行。',
  'agent.greeting': '你好！我是你的自主 AI 专家分身。正在监控企业工作流，随时可以执行常规任务。',
  'agent.composerPlaceholder': '向代理提问...',
  'agent.actionMenu': '操作菜单',
  'agent.contextUsed': '已使用 {used}K / {max}K 上下文',
  'tool.tabConnectors': '连接器',
  'tool.tabSettings': '设置',
  'tool.connectorsHeading': '内置连接器与 MCP 工具',
  'tool.agentConfigHeading': '代理配置',
  'tool.systemPrompt': '系统提示词',
  'tool.modelSelection': '模型选择',
  'tool.modelDeepSeekV3': 'DeepSeek-V3 (671B MoE)',
  'tool.modelDeepSeekR1': 'DeepSeek-R1 (Reasoning)',
  'tool.modelLocalVllm': 'Local Enterprise vLLM Endpoint',
  'tool.defaultSystemPrompt': 'You are an autonomous AI expert twin in Кетос.',
  'tool.coreName': '核心工具',
  'tool.coreDesc': '读取、写入、编辑、bash、subagents',
  'tool.webSearchName': '网页搜索',
  'tool.webSearchDesc': 'DuckDuckGo / 企业搜索代理',
  'tool.inspectorName': '浏览器检查器',
  'tool.inspectorDesc': 'DOM 捕获、元素选择',
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
  'canvas.connectorsTitle': 'Tools & Connectors',
  'canvas.messageSent': 'Message sent: {message}',
  'rail.agentBadge': 'AI',
  'rail.addAgent': 'Add Agent Card',
  'rail.addConnectors': 'Connectors & Tools',
  'rail.resetView': 'Center / Reset Canvas',
  'inspector.selectTarget': '🎯 Select an element or window on the canvas',
  'menu.attachFile': 'Attach file',
  'menu.dictate': 'Dictate',
  'menu.webSearch': 'Web search',
  'menu.selectElement': 'Select an element',
  'menu.connectors': 'Tools & Connectors',
  'menu.openActionMenu': 'Open Action Menu',
  'toolbar.composerPlaceholder': 'Ask me anything...',
  'window.close': 'Close',
  'agent.doneBadge': '✓ Done',
  'agent.learnedCount': '1 learned',
  'agent.statusReady': 'Autonomous Agent ready. Instructions executed.',
  'agent.greeting': 'Hello! I am your autonomous AI expert twin. I am monitoring corporate workflows and ready to execute routine tasks.',
  'agent.composerPlaceholder': 'Ask agent anything...',
  'agent.actionMenu': 'Action Menu',
  'agent.contextUsed': '{used}K / {max}K context used',
  'tool.tabConnectors': 'Connectors',
  'tool.tabSettings': 'Settings',
  'tool.connectorsHeading': 'Built-in Connectors & MCP Tools',
  'tool.agentConfigHeading': 'Agent Configuration',
  'tool.systemPrompt': 'System Prompt',
  'tool.modelSelection': 'Model Selection',
  'tool.modelDeepSeekV3': 'DeepSeek-V3 (671B MoE)',
  'tool.modelDeepSeekR1': 'DeepSeek-R1 (Reasoning)',
  'tool.modelLocalVllm': 'Local Enterprise vLLM Endpoint',
  'tool.defaultSystemPrompt': 'You are an autonomous AI expert twin in Кетос.',
  'tool.coreName': 'Core Tools',
  'tool.coreDesc': 'Read, write, edit, bash, subagents',
  'tool.webSearchName': 'Web Search',
  'tool.webSearchDesc': 'DuckDuckGo / Enterprise Search Proxy',
  'tool.inspectorName': 'Browser Inspector',
  'tool.inspectorDesc': 'DOM capture, element selection',
} satisfies Record<BoardKey, string>
