/**
 * The `/todo` command: it creates a list whose element waits for a visible
 * board tab to place it, and answers with short host text (the composer
 * localizes the command label).
 * @module @ketos/board-todo/command
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinition, CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { BeadsCommandError, beadsCommandErrorText } from './beads.ts'
import { createTodoList } from './routes.ts'
import type { TodoRouteConfig } from './routes.ts'

/** Definition identity the client associates with the `/todo` command. */
export const TODO_COMMAND_ID = '@ketos/board-todo/todo'

/**
 * Build the `/todo` command definition over one route configuration.
 * @param config - the board document, the `bd` wrapper, and the deployment bounds.
 * @returns the command definition to register.
 */
export function todoCommand(config: TodoRouteConfig): CommandDefinition {
  return {
    definitionId: brandString<CommandDefinitionId>(TODO_COMMAND_ID),
    name: 'todo',
    description: 'Add a to-do list to the board',
    input: { hint: '<title>' },
    handler: async (invocation) => {
      const title = invocation.rawInput.trim()
      if (title === '') return { kind: 'error', text: 'Usage: /todo <title>' }
      try {
        await createTodoList(config, { title, x: 0, y: 0, pendingPlacement: true }, invocation.signal)
        return { kind: 'success', text: 'To-do list added to the board.' }
      } catch (error: unknown) {
        config.logger(`/todo: ${error instanceof BeadsCommandError ? beadsCommandErrorText(error) : String(error)}`)
        return { kind: 'error', text: 'The to-do list could not be created.' }
      }
    },
  }
}
