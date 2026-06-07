import { NextRequest, NextResponse } from "next/server";

export function validateApiKey(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const key = authHeader.slice(7);
  if (key !== process.env.MATHESIS_API_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 403 });
  }

  return null;
}
