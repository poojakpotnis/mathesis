import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  WORKSHEET_SANS_FAMILY,
  WORKSHEET_SANS_TTF_BASE64,
} from "./fonts/worksheet-sans-data";

// Width (px) the SVG is rasterized to. The figure is drawn small in the PDF
// (~220pt), so 800px gives ~2.5x supersampling for crisp print/retina output.
const RASTER_WIDTH = 800;

// @resvg/resvg-js loads fonts by file path, not buffer, and Vercel's Lambda has
// no system fonts. So decode the embedded Inter TTF to a temp file once per cold
// start and hand resvg that path. tmpdir() is writable on Vercel.
let fontFilePath: string | null = null;
function ensureFontFile(): string {
  if (fontFilePath && existsSync(fontFilePath)) return fontFilePath;
  const p = join(tmpdir(), "mathesis-worksheet-sans.ttf");
  if (!existsSync(p)) {
    writeFileSync(p, Buffer.from(WORKSHEET_SANS_TTF_BASE64, "base64"));
  }
  fontFilePath = p;
  return p;
}

/**
 * Rasterize a self-contained figure SVG string to a PNG `data:` URI suitable
 * for react-pdf's <Image>. react-pdf cannot embed raw SVG, and a serverless
 * rasterizer can't rely on system fonts — both are handled here.
 *
 * Returns null if the SVG can't be rendered, so a single bad figure degrades to
 * a text-only problem (the problem text is self-contained) rather than failing
 * the whole PDF.
 */
export function figureSvgToPngDataUri(svg: string | null): string | null {
  if (!svg) return null;
  try {
    const resvg = new Resvg(svg, {
      background: "white",
      fitTo: { mode: "width", value: RASTER_WIDTH },
      font: {
        loadSystemFonts: false,
        fontFiles: [ensureFontFile()],
        defaultFontFamily: WORKSHEET_SANS_FAMILY,
      },
    });
    const png = resvg.render().asPng();
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } catch {
    return null;
  }
}
