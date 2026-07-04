# PDF figure font

`worksheet-sans-data.ts` embeds **Inter Regular** (SIL Open Font License 1.1,
see `OFL.txt`) as a base64 string.

It is used only to rasterize generated figure SVGs into PNGs for the worksheet
PDF (`../rasterize.ts`). The font is embedded rather than read from disk so it
ships inside the Vercel serverless bundle without any `outputFileTracingIncludes`
config — at rasterize time it's decoded once to a temp file that `@resvg/resvg-js`
loads via `fontFiles`.

## Regenerate

```sh
# from this directory, with a Roman/Regular Inter TTF as WorksheetSans.ttf:
node -e 'const fs=require("fs");const b=fs.readFileSync("WorksheetSans.ttf").toString("base64");fs.writeFileSync("worksheet-sans-data.ts",`export const WORKSHEET_SANS_FAMILY = "Inter";\nexport const WORKSHEET_SANS_TTF_BASE64 =\n  "${b}";\n`)'
```
