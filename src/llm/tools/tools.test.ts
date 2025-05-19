import { describe, it, expect, setDefaultTimeout } from 'bun:test';
import {
  createReadFileTool,
  createWriteFileTool,
  createFileExistsTool,
  createListDirectoryTool,
} from './file';
import { createGrepTool, createFindFilesTool } from './search';

setDefaultTimeout(60 * 1000 * 10);

const basePath = process.cwd();

describe('File Tools', () => {
  const readFileTool = createReadFileTool(basePath);
  const writeFileTool = createWriteFileTool(basePath);
  const fileExistsTool = createFileExistsTool(basePath);
  const listDirectoryTool = createListDirectoryTool(basePath);

  describe('readFile', () => {
    it('should read a file successfully', async () => {
      const result = await readFileTool.callback({
        path: 'test-samples/sample.txt',
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.totalLines).toBe(10);
      expect(result.content).toContain('This is a sample text file');
    });

    it('should read specific lines from a file', async () => {
      const result = await readFileTool.callback({
        path: 'test-samples/sample.txt',
        startLine: 3,
        endLine: 5,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.startLine).toBe(3);
      expect(result.endLine).toBe(5);
      expect(result.content).toContain('Some lines have specific words');
    });

    it('should read a file from a subdirectory', async () => {
      const result = await readFileTool.callback({
        path: 'test-samples/subdir/nested.txt',
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content).toContain('This is a nested file');
    });
  });

  describe('writeFile', () => {
    it('should write to a file successfully', async () => {
      const testContent = '// Test content\n// For testing purposes';
      const result = await writeFileTool.callback({
        path: 'test-samples/write-test.txt',
        content: testContent,
        createDirectories: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.path).toBe('test-samples/write-test.txt');

      // Verify the content was written correctly
      const readResult = await readFileTool.callback({
        path: 'test-samples/write-test.txt',
      });
      expect(readResult.content).toBe(testContent);
    });
  });

  describe('fileExists', () => {
    it('should check if a file exists', async () => {
      const result = await fileExistsTool.callback({
        path: 'test-samples/sample.txt',
      });

      expect(result).toBeDefined();
      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
      expect(result.isDirectory).toBe(false);
    });

    it('should return false for non-existent files', async () => {
      const result = await fileExistsTool.callback({
        path: 'test-samples/non-existent-file.txt',
      });

      expect(result).toBeDefined();
      expect(result.exists).toBe(false);
      expect(result.isFile).toBe(false);
      expect(result.isDirectory).toBe(false);
    });

    it('should detect directories', async () => {
      const result = await fileExistsTool.callback({
        path: 'test-samples/subdir',
      });

      expect(result).toBeDefined();
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
      expect(result.isFile).toBe(false);
    });
  });

  describe('listDirectory', () => {
    it('should list directory contents', async () => {
      const result = await listDirectoryTool.callback({
        path: 'test-samples',
      });

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
      const result = await listDirectoryTool.callback({
        path: 'test-samples/subdir',
      });

      expect(result).toBeDefined();
      expect(result.files).toContain('nested.txt');
    });
  });
});

describe('Search Tools', () => {
  const grepTool = createGrepTool(basePath);
  const findFilesTool = createFindFilesTool(basePath);

  describe('grepCode', () => {
    it('should search for text in files', async () => {
      const result = await grepTool.callback({
        pattern: 'test',
        paths: ['test-samples'],
        extensions: ['.txt', '.ts'],
        maxResults: 100,
        caseSensitive: false,
      });

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some(r => r?.filePath.includes('sample.txt'))).toBe(true);
      expect(result.results.some(r => r?.filePath.includes('code.ts'))).toBe(true);
    });

    it('should search with case sensitivity', async () => {
      const result = await grepTool.callback({
        pattern: 'Test',
        paths: ['test-samples'],
        extensions: ['.ts'],
        maxResults: 100,
        caseSensitive: true,
      });

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.some(r => r?.filePath.includes('code.ts'))).toBe(true);
    });
  });

  describe('findFiles', () => {
    it('should find files by pattern', async () => {
      const result = await findFilesTool.callback({
        pattern: 'sample',
        directory: 'test-samples',
        extensions: ['.txt'],
        maxResults: 100,
      });

      expect(result).toBeDefined();
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
      expect(result.files).toContain('test-samples/sample.txt');
    });

    it('should find files in subdirectories', async () => {
      const result = await findFilesTool.callback({
        pattern: 'nested',
        directory: 'test-samples',
        extensions: ['.txt'],
        maxResults: 100,
      });

      expect(result).toBeDefined();
      expect(result.files).toBeDefined();
      expect(Array.isArray(result.files)).toBe(true);
      expect(result.files).toContain('test-samples/subdir/nested.txt');
    });
  });
});
