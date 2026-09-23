/**
 * Model-facing autonomous-task reporting: the `clone_task_report` tool that
 * stores the task's final report and completes its goal.
 *
 * The tool is registered into one running task's agent scope, so an ordinary
 * session never sees it; its domain refusals are already `HarnessError`s, so
 * the body propagates them and the executor records their codes on the result.
 * @module @ketos/clone-core/task-tools
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TASK_REPORT_LIMIT } from './task-repository.ts'

/** What one report call reports back to the model. */
export interface ReportedTask {
  /** The task is complete once its report is filed. */
  readonly status: 'done'
}

/**
 * The report tool: stores the final result of the task the calling session is
 * running and completes its goal, which ends the round driver's work.
 * @param report - the write, bound to the plugin's runner and the calling session.
 * @returns the tool definition to register.
 */
export function cloneTaskReportTool(
  report: (sessionId: SessionId, summary: string) => Promise<void>,
): ToolDefinition {
  return defineTool({
    name: 'clone_task_report',
    description: [
      'File the final report of the autonomous task this session is running and finish the task.',
      'Call it once, when the objective is achieved, with the complete result the person will read.',
      `The summary is at most ${String(TASK_REPORT_LIMIT)} characters.`,
      'After this call the task is complete; do not keep working on it.',
    ].join(' '),
    parameters: {
      summary: {
        type: 'string',
        required: true,
        description: 'The final result: what was done, what it produced, and anything the person must know.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['done'] },
        },
      },
      render: () => [{ type: 'text', text: 'Report saved; the task is complete.' }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('clone_task_report requires a calling agent session')
      await report(agent.id, args.summary)
      return { status: 'done' as const }
    },
    presentCall: args => ({ card: 'generic', title: 'Report task result', kind: 'other', rawInput: args }),
  })
}
