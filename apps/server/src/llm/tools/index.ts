import { type WrappedTool } from './types';

import * as readFs from './read-fs';
import * as writeFs from './write-fs';
import * as interactive from './interactive';
import * as task from './task';
import * as reasoning from './reasoning';

const readonlyTools: WrappedTool[] = [...Object.values(readFs)];
const writableTools: WrappedTool[] = [...Object.values(writeFs)];

const interactiveTools: WrappedTool[] = [...Object.values(interactive)];
const taskTools: WrappedTool[] = [...Object.values(task)];
const reasoningTools: WrappedTool[] = [...Object.values(reasoning)];

const allTools: WrappedTool[] = [
  ...readonlyTools,
  ...writableTools,
  ...interactiveTools,
  ...taskTools,
  ...reasoningTools,
];

export { writableTools, readonlyTools, interactiveTools, taskTools, reasoningTools, allTools };
