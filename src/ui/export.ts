// Renders the active sheet + its results to a PNG and copies it to the
// clipboard, falling back to a Save As dialog when the Clipboard API is
// unavailable (e.g. the window lost focus).
import { writeImageFile } from "../storage";

export interface ExportImageDeps {
  lines: string[];
  results: { text: string | null }[];
  fontSize: number;
  toast(msg: string): void;
  t(key: string): string;
}

export async function exportSheetImage(deps: ExportImageDeps): Promise<void> {
  const { lines: rawLines, results: doc, fontSize, toast, t } = deps;
  const dpr = window.devicePixelRatio || 1;
  const style = getComputedStyle(document.documentElement);
  const bgColor = style.getPropertyValue("--bg").trim() || "#ffffff";
  const fgColor = style.getPropertyValue("--fg").trim() || "#333333";
  const resultColor = style.getPropertyValue("--result").trim() || "#d57d2c";
  const monoFont = style.getPropertyValue("--mono").trim() || "monospace";
  const lineH = Math.round(fontSize * 1.7);
  const padX = 20, padTop = 16, padBot = 16;

  const canvas = document.createElement("canvas");
  const ctx2 = canvas.getContext("2d")!;
  ctx2.font = `${fontSize}px ${monoFont}`;
  const maxWidth = rawLines.reduce((m, l) => Math.max(m, ctx2.measureText(l).width), 0) + padX * 4 + 150;
  const w = Math.max(400, maxWidth);
  const h = padTop + rawLines.length * lineH + padBot;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx2.scale(dpr, dpr);

  ctx2.fillStyle = bgColor;
  ctx2.fillRect(0, 0, w, h);

  ctx2.font = `${fontSize}px ${monoFont}`;
  for (let i = 0; i < rawLines.length; i++) {
    const y = padTop + i * lineH + fontSize;
    ctx2.fillStyle = fgColor;
    ctx2.fillText(rawLines[i], padX, y);
    const res = doc[i]?.text;
    if (res) {
      ctx2.fillStyle = resultColor;
      const rx = w - padX - ctx2.measureText(res).width;
      ctx2.fillText(res, rx, y);
    }
  }

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) { toast(t("imageFailed")); return; }

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(t("imageCopied"));
  } catch {
    // clipboard API failed — save to file
    try {
      const buf = await blob.arrayBuffer();
      const b64 = bytesToBase64(new Uint8Array(buf));
      if (await writeImageFile(b64)) {
        toast(t("saved"));
      }
    } catch {
      toast(t("imageFailed"));
    }
  }
}

/** chunked to avoid "Maximum call stack size exceeded" from spreading a large array as args */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
