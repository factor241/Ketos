/**
 * Body of a light window: the connectors roster or the agent-configuration
 * form, selected by the window's `bodyKind`.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ToolWindowBody.module.css'

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
  ]
  return (
    <div>
      <div className={css.heading}>
        {t('tool.connectorsHeading')}
      </div>
      {tools.map(tool => (
        <div key={tool.name} className={css.row}>
          <div>
            <div className={css.rowName}>{tool.name}</div>
            <div className={css.rowDesc}>{tool.desc}</div>
          </div>
          <div className={clsx(css.switch, tool.enabled && css.on)}>
            <div className={css.switchKnob} />
          </div>
        </div>
      ))}
    </div>
  )
}

function SettingsPane({ t }: { t: ToolWindowBodyProps['t'] }) {
  return (
    <div>
      <div className={clsx(css.heading, css.headingWide)}>
        {t('tool.agentConfigHeading')}
      </div>
      <div className={css.field}>
        <label className={css.fieldLabel}>{t('tool.systemPrompt')}</label>
        <textarea
          defaultValue={t('tool.defaultSystemPrompt')}
          rows={3}
          className={css.textarea}
        />
      </div>
      <div className={css.field}>
        <label className={css.fieldLabel}>{t('tool.modelSelection')}</label>
        <select className={css.select}>
          <option>{t('tool.modelDeepSeekV3')}</option>
          <option>{t('tool.modelDeepSeekR1')}</option>
          <option>{t('tool.modelLocalVllm')}</option>
        </select>
      </div>
    </div>
  )
}
