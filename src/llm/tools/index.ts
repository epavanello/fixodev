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

const writableTools: WrappedTool[] = [writeFileTool];
const readonlyTools: WrappedTool[] = [
  fileExistsTool,
  listDirectoryTool,
  readFileTool,
  showFileTreeTool,
];
const searchTools: WrappedTool[] = [findFilesTool, grepCodeTool];
const interactiveTools: WrappedTool[] = [askUserTool];
const taskTools: WrappedTool[] = [taskCompletionTool];
const allTools: WrappedTool[] = [
  ...readonlyTools,
  ...writableTools,
  ...searchTools,
  ...interactiveTools,
  ...taskTools,
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
  allTools,
};
