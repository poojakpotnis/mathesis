import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setProblemVerificationAction } from "@/lib/actions/worksheets";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  verificationStatus: z.enum([
    "verified",
    "flagged",
    "approved",
    "confirmed_flagged",
  ]),
  reason: z.string().max(1000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; problemId: string }> }
) {
  const { id: idParam, problemId: problemIdParam } = await params;
  const worksheetId = parseInt(idParam, 10);
  const problemId = parseInt(problemIdParam, 10);
  if (
    !Number.isFinite(worksheetId) ||
    worksheetId <= 0 ||
    !Number.isFinite(problemId) ||
    problemId <= 0
  ) {
    return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Route through the server action so this API and the UI dialog share one
  // path — and any flagged -> approved/confirmed_flagged transition pushes
  // a Phoenix annotation onto the verifier's span (Phase 5e).
  const result = await setProblemVerificationAction(
    worksheetId,
    problemId,
    parsed.data.verificationStatus,
    parsed.data.reason
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    id: problemId,
    verificationStatus: parsed.data.verificationStatus,
    annotation: result.annotation,
  });
}
