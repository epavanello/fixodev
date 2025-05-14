import { describe, it, expect, setDefaultTimeout } from 'bun:test';
import { analyzeCode } from './processor';

setDefaultTimeout(60 * 1000 * 10);

describe.skip('analyzeCode', () => {
  it('should analyze code without throwing exceptions', async () => {
    const { analysis } = await analyzeCode({
      command: 'Change the readme title to "Test"',
      repositoryPath: 'repos/test',
    });

    expect(analysis).toBeDefined();
    expect(analysis.changes).toBeDefined();
    expect(analysis.changes.length).toBeGreaterThan(0);
  });
});
