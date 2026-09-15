/**
 * Body of a light window: the connectors roster or the agent-configuration
 * form, selected by the window's `bodyKind`.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type ToolWindowBodyProps =
  PropsRuntime<'board.window.body'>
  & PropsLocale<'board'>

export function ToolWindowBody({ window: cardWindow, t }: ToolWindowBodyProps) {
  return cardWindow.bodyKind === 'settings' ? <SettingsPane t={t} /> : <ConnectorsPane t={t} />
}

function ConnectorsPane({ t }: { t: ToolWindowBodyProps['t'] }) {
  const tools = [
    { name: t('tool.coreName'), desc: t('tool.coreDesc'), enabled: true },
    { name: t('tool.webSearchName'), desc: t('tool.webSearchDesc'), enabled: true },
    { name: t('tool.inspectorName'), desc: t('tool.inspectorDesc'), enabled: true },
    { name: t('tool.temporalName'), desc: t('tool.temporalDesc'), enabled: true },
    { name: t('tool.mcpName'), desc: t('tool.mcpDesc'), enabled: false },
  ]
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#787570', fontSize: 11, textTransform: 'uppercase' }}>
        {t('tool.connectorsHeading')}
      </div>
      {tools.map(tool => (
        <div
          key={tool.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderRadius: 8,
            background: '#FAFAF8',
            marginBottom: 8,
            border: '1px solid #F0EEEA',
          }}
        >
          <div>
            <div style={{ fontWeight: 500 }}>{tool.name}</div>
            <div style={{ fontSize: 11, color: '#787570' }}>{tool.desc}</div>
          </div>
          <div
            style={{
              width: 32,
              height: 18,
              borderRadius: 9999,
              background: tool.enabled ? '#B8532F' : '#E0DED9',
              position: 'relative',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#FFFFFF',
                position: 'absolute',
                top: 2,
                left: tool.enabled ? 16 : 2,
                transition: 'left 0.15s ease',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function SettingsPane({ t }: { t: ToolWindowBodyProps['t'] }) {
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 12, color: '#787570', fontSize: 11, textTransform: 'uppercase' }}>
        {t('tool.agentConfigHeading')}
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{t('tool.systemPrompt')}</label>
        <textarea
          defaultValue={t('tool.defaultSystemPrompt')}
          rows={3}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #E8E6E1',
            fontSize: 12,
            outline: 'none',
            fontFamily: 'inherit',
            resize: 'none',
          }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{t('tool.modelSelection')}</label>
        <select
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #E8E6E1',
            fontSize: 12,
            background: '#FFFFFF',
          }}
        >
          <option>{t('tool.modelDeepSeekV3')}</option>
          <option>{t('tool.modelDeepSeekR1')}</option>
          <option>{t('tool.modelLocalVllm')}</option>
        </select>
      </div>
    </div>
  )
}
