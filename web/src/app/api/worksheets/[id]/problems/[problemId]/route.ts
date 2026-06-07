import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { generatedProblems } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  verificationStatus: z.enum(["verified", "flagged"]),
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

  const updated = await db()
    .update(generatedProblems)
    .set({ verificationStatus: parsed.data.verificationStatus })
    .where(
      and(
        eq(generatedProblems.id, problemId),
        eq(generatedProblems.worksheetId, worksheetId)
      )
    )
    .returning({
      id: generatedProblems.id,
      verificationStatus: generatedProblems.verificationStatus,
    });

  if (updated.length === 0) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  return NextResponse.json(updated[0]);
}
