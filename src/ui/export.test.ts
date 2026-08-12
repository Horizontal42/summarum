import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportSheetImage } from './export';
import { writeImageFile } from '../storage';

vi.mock('../storage', () => ({
  writeImageFile: vi.fn(),
}));

describe('exportSheetImage', () => {
  let mockContext2D: any;
  let mockCanvas: any;
  let toastMock: any;
  let tMock: any;

  beforeEach(() => {
    toastMock = vi.fn();
    tMock = vi.fn((key: string) => `trans_${key}`);

    mockContext2D = {
      measureText: vi.fn().mockReturnValue({ width: 10 }),
      scale: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      font: '',
      fillStyle: '',
    };

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockContext2D),
      toBlob: vi.fn((cb) => cb(new Blob(['fake-image-data'], { type: 'image/png' }))),
      width: 0,
      height: 0,
    };

    vi.stubGlobal('document', {
      documentElement: {},
      createElement: vi.fn((tag) => {
        if (tag === 'canvas') return mockCanvas;
        return {};
      })
    });

    vi.stubGlobal('window', {
      devicePixelRatio: 0
    });

    vi.stubGlobal('getComputedStyle', vi.fn().mockReturnValue({
      getPropertyValue: vi.fn((prop) => {
        if (prop === '--bg') return '';
        if (prop === '--fg') return '';
        if (prop === '--result') return '';
        if (prop === '--mono') return '';
        return '';
      })
    }));

    vi.stubGlobal('Blob', class Blob {
      content: any[];
      options: any;
      constructor(content: any[], options: any) {
        this.content = content;
        this.options = options;
      }
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      }
    });

    vi.stubGlobal('ClipboardItem', class ClipboardItem {
      constructor(data: any) {
        Object.assign(this, data);
      }
    });

    vi.stubGlobal('navigator', {
      clipboard: {
        write: vi.fn().mockResolvedValue(undefined)
      }
    });

    vi.stubGlobal('btoa', (str: string) => Buffer.from(str, 'binary').toString('base64'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('should create a canvas and copy it to clipboard successfully', async () => {
    await exportSheetImage({
      lines: ['1 + 1'],
      results: [{ text: '2' }],
      fontSize: 14,
      toast: toastMock,
      t: tMock
    });

    expect(document.createElement).toHaveBeenCalledWith('canvas');
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    expect(mockContext2D.fillText).toHaveBeenCalledWith('1 + 1', expect.any(Number), expect.any(Number));
    expect(mockContext2D.fillText).toHaveBeenCalledWith('2', expect.any(Number), expect.any(Number));

    expect(navigator.clipboard.write).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('trans_imageCopied');
  });

  it('should handle blob failure', async () => {
    mockCanvas.toBlob = vi.fn((cb) => cb(null));

    await exportSheetImage({
      lines: ['test'],
      results: [{ text: null }],
      fontSize: 14,
      toast: toastMock,
      t: tMock
    });

    expect(toastMock).toHaveBeenCalledWith('trans_imageFailed');
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  it('should fallback to writeImageFile when clipboard write fails', async () => {
    navigator.clipboard.write = vi.fn().mockRejectedValue(new Error('clipboard fail'));
    vi.mocked(writeImageFile).mockResolvedValue(true);

    await exportSheetImage({
      lines: ['fallback'],
      results: [{ text: 'res' }],
      fontSize: 14,
      toast: toastMock,
      t: tMock
    });

    expect(navigator.clipboard.write).toHaveBeenCalled();
    expect(writeImageFile).toHaveBeenCalled();
    expect(writeImageFile).toHaveBeenCalledWith('AQID');
    expect(toastMock).toHaveBeenCalledWith('trans_saved');
  });

  it('should handle writeImageFile failure in fallback', async () => {
    navigator.clipboard.write = vi.fn().mockRejectedValue(new Error('clipboard fail'));
    vi.mocked(writeImageFile).mockRejectedValue(new Error('save fail'));

    await exportSheetImage({
      lines: ['fail'],
      results: [{ text: 'res' }],
      fontSize: 14,
      toast: toastMock,
      t: tMock
    });

    expect(writeImageFile).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('trans_imageFailed');
  });

  it('should handle writeImageFile returning false', async () => {
    navigator.clipboard.write = vi.fn().mockRejectedValue(new Error('clipboard fail'));
    vi.mocked(writeImageFile).mockResolvedValue(false);

    await exportSheetImage({
      lines: ['fail'],
      results: [{ text: 'res' }],
      fontSize: 14,
      toast: toastMock,
      t: tMock
    });

    expect(writeImageFile).toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalledWith('trans_saved');
  });
});
