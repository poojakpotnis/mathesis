import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db/client";
import {
  worksheets,
  lessons,
  generatedProblems,
} from "@/lib/db/schema";
import { WorksheetPdf } from "@/lib/pdf/worksheet-pdf";
import { figureSvgToPngDataUri } from "@/lib/pdf/rasterize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [worksheet] = await db()
    .select({
      id: worksheets.id,
      title: worksheets.title,
      createdAt: worksheets.createdAt,
      lessonNumber: lessons.lessonNumber,
      lessonTitle: lessons.title,
    })
    .from(worksheets)
    .innerJoin(lessons, eq(worksheets.lessonId, lessons.id))
    .where(eq(worksheets.id, id))
    .limit(1);

  if (!worksheet) {
    return NextResponse.json({ error: "Worksheet not found" }, { status: 404 });
  }

  const problemRows = await db()
    .select({
      displayOrder: generatedProblems.displayOrder,
      problemText: generatedProblems.problemText,
      problemLatex: generatedProblems.problemLatex,
      figureSvg: generatedProblems.figureSvg,
      correctAnswer: generatedProblems.correctAnswer,
      answerFormatType: generatedProblems.answerFormatType,
      solutionSteps: generatedProblems.solutionSteps,
      verificationStatus: generatedProblems.verificationStatus,
    })
    .from(generatedProblems)
    .where(eq(generatedProblems.worksheetId, id))
    .orderBy(generatedProblems.displayOrder);

  // Rasterize each figure SVG to a PNG data URI here (react-pdf can't embed raw
  // SVG). A figure that fails to render becomes null and the problem prints as
  // text-only — the text is self-contained, so nothing is lost.
  const problems = problemRows.map(({ figureSvg, ...p }) => ({
    ...p,
    figurePng: figureSvgToPngDataUri(figureSvg),
  }));

  const buffer = await renderToBuffer(
    <WorksheetPdf
      worksheet={{
        id: worksheet.id,
        title: worksheet.title,
        lessonTitle: worksheet.lessonTitle,
        lessonNumber: worksheet.lessonNumber,
        createdAt: worksheet.createdAt,
        problems,
      }}
    />
  );

  const safeName = worksheet.title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName || "worksheet"}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
