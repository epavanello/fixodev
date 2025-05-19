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

const writableTools = [writeFileTool];
const readonlyTools = [fileExistsTool, listDirectoryTool, readFileTool, showFileTreeTool];
const searchTools = [findFilesTool, grepCodeTool];
const interactiveTools = [askUserTool];
const taskTools = [taskCompletionTool];
const allTools = [
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
