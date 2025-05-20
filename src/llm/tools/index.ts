import {
  fileExistsTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool,
  showFileTreeTool,
} from './file';
import { findFilesTool, grepCodeTool } from './search';
import { askUserTool } from './interactive';
import { taskCompletionTool } from './task';
import { WrappedTool } from './types';
import { thinkTool } from './reasoning';

const writableTools: WrappedTool[] = [writeFileTool];
const readonlyTools: WrappedTool[] = [
  fileExistsTool,
  listDirectoryTool,
  readFileTool,
  showFileTreeTool,
];
const searchTools: WrappedTool[] = [findFilesTool, grepCodeTool];
const interactiveTools: WrappedTool[] = [askUserTool];
const taskTools: WrappedTool[] = [taskCompletionTool, thinkTool];
const reasoningTools: WrappedTool[] = [thinkTool];
const allTools: WrappedTool[] = [
  ...readonlyTools,
  ...writableTools,
  ...searchTools,
  ...interactiveTools,
  ...taskTools,
  ...reasoningTools,
];

export {
  fileExistsTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool,
  showFileTreeTool,
  findFilesTool,
  grepCodeTool,
  askUserTool,
  taskCompletionTool,
  writableTools,
  readonlyTools,
  searchTools,
  interactiveTools,
  taskTools,
  reasoningTools,
  allTools,
};
