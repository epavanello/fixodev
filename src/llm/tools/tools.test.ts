import { describe, it, expect, setDefaultTimeout } from 'bun:test';
import {
  readFileTool,
  writeFileTool,
  fileExistsTool,
  listDirectoryTool,
  showFileTreeTool,
} from './file';
import { grepCodeTool, findFilesTool } from './search';
import { ToolContext } from './types';

setDefaultTimeout(60 * 1000 * 10);

const basePath = process.cwd();

describe('Tools', () => {
  const context: ToolContext = { basePath };

  const options = {
    messages: [],
    toolCallId: '',
  };

  it('should read a file successfully', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/sample.txt',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.totalLines).toBe(10);
    expect(result.content).toContain('This is a sample text file');
  });

  it('should read specific lines from a file', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/sample.txt',
        startLine: 3,
        endLine: 5,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.startLine).toBe(3);
    expect(result.endLine).toBe(5);
    expect(result.content).toContain('Some lines have specific words');
  });

  it('should read a file from a subdirectory', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/subdir/nested.txt',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content).toContain('This is a nested file');
  });

  it('should write to a file successfully', async () => {
    const testContent = '// Test content\n// For testing purposes';
    const result = await writeFileTool.execute(
      {
        path: 'test-samples/write-test.txt',
        content: testContent,
        createDirectories: true,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.path).toBe('test-samples/write-test.txt');

    const readResult = await readFileTool.execute(
      {
        path: 'test-samples/write-test.txt',
      },
      options,
      context,
    );
    expect(readResult.content).toBe(testContent);
  });

  it('should check if a file exists', async () => {
    const result = await fileExistsTool.execute(
      {
        path: 'test-samples/sample.txt',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
  });

  it('should return false for non-existent files', async () => {
    const result = await fileExistsTool.execute(
      {
        path: 'test-samples/non-existent-file.txt',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.exists).toBe(false);
    expect(result.isFile).toBe(false);
    expect(result.isDirectory).toBe(false);
  });

  it('should detect directories', async () => {
    const result = await fileExistsTool.execute(
      {
        path: 'test-samples/subdir',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result.isFile).toBe(false);
  });

  it('should list directory contents', async () => {
    const result = await listDirectoryTool.execute(
      {
        path: 'test-samples',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.files).toBeDefined();
    expect(result.directories).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(Array.isArray(result.directories)).toBe(true);
    expect(result.files).toContain('sample.txt');
    expect(result.files).toContain('code.ts');
    expect(result.directories).toContain('subdir');
  });

  it('should list nested directory contents', async () => {
    const result = await listDirectoryTool.execute(
      {
        path: 'test-samples/subdir',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.files).toContain('nested.txt');
  });

  it('should show the file tree of a directory', async () => {
    const result = await showFileTreeTool.execute(
      {
        path: 'test-samples',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.tree).toBeDefined();
    expect(Array.isArray(result.tree)).toBe(true);
    expect(result.tree.some(entry => entry.name === 'sample.txt')).toBe(true);
    expect(result.tree.some(entry => entry.name === 'subdir')).toBe(true);
  });

  it('should search for text in files', async () => {
    const result = await grepCodeTool.execute(
      {
        pattern: 'test',
        paths: ['test-samples'],
        extensions: ['.txt', '.ts'],
        maxResults: 100,
        caseSensitive: false,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some(r => r?.filePath.includes('sample.txt'))).toBe(true);
    expect(result.results.some(r => r?.filePath.includes('code.ts'))).toBe(true);
  });
  it('should search with case sensitivity', async () => {
    const result = await grepCodeTool.execute(
      {
        pattern: 'Test',
        paths: ['test-samples'],
        extensions: ['.ts'],
        maxResults: 100,
        caseSensitive: true,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.some(r => r?.filePath.includes('code.ts'))).toBe(true);
  });
  it('should find files by pattern', async () => {
    const result = await findFilesTool.execute(
      {
        pattern: 'sample',
        directory: 'test-samples',
        extensions: ['.txt'],
        maxResults: 100,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toContain('test-samples/sample.txt');
  });
  it('should find files in subdirectories', async () => {
    const result = await findFilesTool.execute(
      {
        pattern: 'nested',
        directory: 'test-samples',
        extensions: ['.txt'],
        maxResults: 100,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toContain('test-samples/subdir/nested.txt');
  });
});
