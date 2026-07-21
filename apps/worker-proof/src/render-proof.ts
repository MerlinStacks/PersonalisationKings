import type { Browser } from "playwright";

const maximumSvgBytes = 50 * 1024 * 1024;

export interface ProofSource {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

export function validateProofSource(source: ProofSource) {
  if (source.bytes.byteLength === 0 || source.bytes.byteLength > maximumSvgBytes) {
    throw new RangeError("Proof SVG must be between 1 byte and 50 MiB");
  }
  if (!Number.isSafeInteger(source.widthPx) || !Number.isSafeInteger(source.heightPx)
    || source.widthPx < 1 || source.heightPx < 1 || source.widthPx > 4096 || source.heightPx > 4096) {
    throw new RangeError("Proof dimensions must be integers between 1 and 4096 pixels");
  }

  const svg = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
  if (!svg.startsWith("<svg ") || !svg.includes('data-renderer="preview-svg.v1"') || !svg.endsWith("</svg>")) {
    throw new TypeError("Proof source is not a supported generated preview");
  }
  const dimensions = /^<svg\s[^>]*\bwidth="(\d+)"\s+height="(\d+)"/.exec(svg);
  if (!dimensions || Number(dimensions[1]) !== source.widthPx || Number(dimensions[2]) !== source.heightPx) {
    throw new TypeError("Proof source dimensions do not match its recorded preview dimensions");
  }
  if (/<(?:script|foreignObject)\b|@import\b|\b(?:href|src)\s*=\s*["'](?!data:)/i.test(svg)) {
    throw new TypeError("Proof source contains external or executable content");
  }
  return svg;
}

export async function renderProofPng(browser: Browser, source: ProofSource) {
  const svg = validateProofSource(source);
  const context = await browser.newContext({
    viewport: { width: source.widthPx, height: source.heightPx },
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
    reducedMotion: "reduce"
  });

  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort("blockedbyclient"));
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}#proof{width:${source.widthPx}px;height:${source.heightPx}px}#proof>svg{display:block;width:100%;height:100%}</style></head><body><div id="proof">${svg}</div></body></html>`,
      { waitUntil: "load", timeout: 15_000 }
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    return new Uint8Array(await page.locator("#proof").screenshot({ type: "png", animations: "disabled", timeout: 15_000 }));
  } finally {
    await context.close();
  }
}
