import { describe, it, expect, setDefaultTimeout, mock, spyOn } from 'bun:test';
import * as fs from 'fs/promises';
import {
  readFileTool,
  fileExistsTool,
  listDirectoryTool,
  showFileTreeTool,
  grepCodeTool,
  findFilesTool,
  FileEntry,
} from './read-fs';
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
    if ('error' in result) throw new Error(result.error); // Fail test if error
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
    if ('error' in result) throw new Error(result.error);
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
    if ('error' in result) throw new Error(result.error);
    expect(result.content).toBeDefined();
    expect(result.content).toContain('This is a nested file');
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
    if ('error' in result) throw new Error(result.error);
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
    if ('error' in result) throw new Error(result.error);
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
    if ('error' in result) throw new Error(result.error);
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
    if ('error' in result) throw new Error(result.error);
    expect(result.files).toBeDefined();
    expect(result.directories).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(Array.isArray(result.directories)).toBe(true);

    // Map and verify the expected files and their line counts
    const expectedFiles: { name: string; lineCount: number }[] = [
      { name: 'code.ts', lineCount: 28 },
      { name: 'write-test.txt', lineCount: 2 },
      { name: 'sample.txt', lineCount: 10 },
    ];

    expectedFiles.forEach(expected => {
      const foundFile = result.files?.find((file: FileEntry) => file[0] === expected.name);
      expect(foundFile).toBeDefined();
      expect(foundFile?.[1]).toBe(expected.lineCount);
    });

    expect(result.directories?.[0]).toContain('subdir');
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
    if ('error' in result) throw new Error(result.error);
    expect(result.files?.[0]).toEqual(['nested.txt', 4]);
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
    if ('error' in result) throw new Error(result.error);
    expect(result.tree).toBeDefined();
    expect(Array.isArray(result.tree)).toBe(true);

    // Check for file entry [name, lineCount]
    const sampleFileEntry = result.tree?.find(
      (entry: any): entry is FileEntry =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[0] === 'sample.txt',
    ) as FileEntry | undefined;
    expect(sampleFileEntry).toBeDefined();
    expect(sampleFileEntry?.[0]).toBe('sample.txt');
    expect(sampleFileEntry?.[1]).toBe(10); // Assuming sample.txt has 10 lines

    // Check for directory entry [name, children[]]
    const subdirEntry = result.tree?.find(
      (entry: any) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[0] === 'subdir' &&
        Array.isArray(entry[1]),
    );
    expect(subdirEntry).toBeDefined();
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
    if ('error' in result) throw new Error(result.error);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    // file is [filePath, totalLineCount]
    expect(result.results.some(r => r?.file[0].includes('sample.txt'))).toBe(true);
    expect(result.results.some(r => r?.file[0].includes('code.ts'))).toBe(true);
  });

  it('should search with case sensitivity', async () => {
    const result = await grepCodeTool.execute(
      {
        pattern: 'Test', // Case sensitive
        paths: ['test-samples'],
        extensions: ['.ts'],
        maxResults: 100,
        caseSensitive: true,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.some(r => r?.file[0].includes('code.ts'))).toBe(true);
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
    if ('error' in result) throw new Error(result.error);
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    // result.files is Array<[relativePath, lineCount]>
    expect(
      result.files.some(
        fileEntry => fileEntry[0] === 'test-samples/sample.txt' && fileEntry[1] === 10,
      ),
    ).toBe(true);
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
    if ('error' in result) throw new Error(result.error);
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    // result.files is Array<FileEntry>
    expect(
      result.files.some(
        fileEntry => fileEntry[0] === 'test-samples/subdir/nested.txt' && fileEntry[1] === 4,
      ),
    ).toBe(true);
  });

  // New tests for error handling and edge cases

  it('should handle empty files correctly', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/empty.txt',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.content).toBe('');
    expect(result.totalLines).toBe(1); // Empty file still counts as 1 line
  });

  it('should handle reading first and last lines of a file', async () => {
    // First line
    const firstLineResult = await readFileTool.execute(
      {
        path: 'test-samples/sample.txt',
        startLine: 1,
        endLine: 1,
      },
      options,
      context,
    );

    expect(firstLineResult).toBeDefined();
    if ('error' in firstLineResult) throw new Error(firstLineResult.error);
    expect(firstLineResult.content).toBeDefined();
    expect(firstLineResult.startLine).toBe(1);
    expect(firstLineResult.endLine).toBe(1);

    // Last line
    const lastLineResult = await readFileTool.execute(
      {
        path: 'test-samples/sample.txt',
        startLine: 10,
        endLine: 10,
      },
      options,
      context,
    );

    expect(lastLineResult).toBeDefined();
    if ('error' in lastLineResult) throw new Error(lastLineResult.error);
    expect(lastLineResult.content).toBeDefined();
    expect(lastLineResult.startLine).toBe(10);
    expect(lastLineResult.endLine).toBe(10);
  });

  it('should handle out-of-bounds line numbers gracefully', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/sample.txt',
        startLine: 100, // Beyond file length
        endLine: 200,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.content).toBe(''); // Should return empty string for out of bounds
  });

  it('should handle negative line numbers by defaulting to valid ranges', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/sample.txt',
        startLine: -5, // Invalid, should be treated as 1
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    // The implementation should handle this by using Math.max(0, startLine - 1)
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('should return error for non-existent files in readFile', async () => {
    const result = await readFileTool.execute(
      {
        path: 'test-samples/does-not-exist.txt',
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('File not found');
    }
  });

  it('should prevent path traversal attacks', async () => {
    // Try to access a file outside the base path
    const result = await readFileTool.execute(
      {
        path: '../../../etc/passwd', // Path traversal attempt
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Access denied');
    }
  });

  it('should respect maxResults parameter in grepCode', async () => {
    // Test with a very low maxResults value
    const result = await grepCodeTool.execute(
      {
        pattern: 'a',
        paths: ['test-samples'],
        maxResults: 3,
        caseSensitive: false,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeLessThanOrEqual(3);
  });

  it('should handle regex patterns in grepCode', async () => {
    // Test with a regex pattern
    const result = await grepCodeTool.execute(
      {
        pattern: '\\btest\\b', // Word boundary regex for "test"
        paths: ['test-samples'],
        maxResults: 10,
        caseSensitive: false,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    // Results should only include matches for the whole word "test"
    result.results.forEach(r => {
      expect(r.content.match(/\btest\b/i)).not.toBeNull();
    });
  });

  it('should handle complex glob patterns in findFiles', async () => {
    // Test with a more complex pattern
    const result = await findFilesTool.execute(
      {
        pattern: '*.ts', // Glob pattern for all .ts files
        directory: 'test-samples',
        maxResults: 10,
      },
      options,
      context,
    );

    expect(result).toBeDefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    // All results should be .ts files
    result.files.forEach(file => {
      expect(file[0].endsWith('.ts')).toBe(true);
    });
  });
});
