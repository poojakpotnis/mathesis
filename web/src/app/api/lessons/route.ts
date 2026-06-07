import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lessons } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db()
    .select()
    .from(lessons)
    .orderBy(desc(lessons.lessonNumber));

  return NextResponse.json(rows);
}
