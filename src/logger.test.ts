import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call console.info with correct arguments', () => {
    logger.info('test info', { key: 'value' });
    expect(console.info).toHaveBeenCalledWith('test info', { key: 'value' });
  });

  it('should call console.warn with correct arguments', () => {
    logger.warn('test warn', 42);
    expect(console.warn).toHaveBeenCalledWith('test warn', 42);
  });

  it('should call console.error with correct arguments', () => {
    const error = new Error('test error');
    logger.error('test error message', error);
    expect(console.error).toHaveBeenCalledWith('test error message', error);
  });
});
