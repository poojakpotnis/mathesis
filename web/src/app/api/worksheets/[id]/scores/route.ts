import { NextRequest, NextResponse } from "next/server";
import { submitScoreAction } from "@/lib/actions/worksheets";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const key = process.env.MATHESIS_API_KEY;
  if (!key) return false;
  return auth === `Bearer ${key}`;
}

type Body = {
  problemId?: number;
  isCorrect?: boolean;
  parentNotes?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idParam } = await params;
  const worksheetId = parseInt(idParam, 10);
  if (!Number.isFinite(worksheetId) || worksheetId <= 0) {
    return NextResponse.json({ error: "Invalid worksheet id" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Number.isInteger(body.problemId) || (body.problemId as number) <= 0) {
    return NextResponse.json({ error: "problemId required" }, { status: 400 });
  }
  if (typeof body.isCorrect !== "boolean") {
    return NextResponse.json(
      { error: "isCorrect (boolean) required" },
      { status: 400 }
    );
  }

  const result = await submitScoreAction(
    worksheetId,
    body.problemId as number,
    body.isCorrect,
    body.parentNotes
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    totalCorrect: result.totalCorrect,
    totalAttempted: result.totalAttempted,
    worksheetStatus: result.worksheetStatus,
  });
}
