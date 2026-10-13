import { Type, type Static } from '@sinclair/typebox';
import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';

/** The item shape the renderer's TodoWriteBlock reads. */
export const TodoItemSchema = Type.Object({
  content: Type.String({
    minLength: 1,
    description: 'The task, in the imperative ("Run the tests").',
  }),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('cancelled'),
  ]),
  id: Type.Optional(Type.String({ description: 'A stable id for the item.' })),
  activeForm: Type.Optional(
    Type.String({
      description:
        'The task in the present tense ("Running the tests"), shown while it is in progress.',
    })
  ),
});

export const TodoWriteParams = Type.Object({
  todos: Type.Array(TodoItemSchema, {
    description: 'The complete task list. It replaces the previous list.',
  }),
});

export type TodoWriteInput = Static<typeof TodoWriteParams>;

/**
 * The list is not stored here. The model sends all of it on every call, and it lives in the
 * `tool_use` block that the session already saves and the chat already renders.
 */
function createTodoWriteTool(): AgentRuntimeCustomTool {
  return {
    name: 'TodoWrite',
    label: 'TodoWrite',
    description:
      'Track the steps of a multi-step task as a list the user can follow. Use it when a task needs ' +
      'three or more steps, or when the user gives several tasks; skip it for a single trivial step. ' +
      'Send the complete list on every call, since it replaces the previous one. Keep at most one item ' +
      'in_progress, set it before you start that item, and mark it completed as soon as it is done. ' +
      'Mark an item cancelled when you drop it.',
    parameters: TodoWriteParams,
    async execute(_toolCallId: string, params: unknown) {
      const { todos } = params as TodoWriteInput;
      const completed = todos.filter((todo) => todo.status === 'completed').length;
      return {
        content: [
          {
            type: 'text' as const,
            text: `Todos updated: ${completed} of ${todos.length} completed.`,
          },
        ],
        details: undefined,
      };
    },
  };
}

export class TodoExtension implements AgentRuntimeExtension {
  readonly name = 'todo';

  async beforeSessionRun(): Promise<BeforeSessionRunResult> {
    return { customTools: [createTodoWriteTool()] };
  }
}
