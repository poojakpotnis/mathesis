"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

type WorksheetRow = {
  id: number;
  lessonId: number;
  lessonNumber: number;
  lessonTitle: string;
  title: string;
  createdAt: string;
  totalProblems: number;
  difficultyLevel: "easier" | "match" | "harder" | "progressive";
  status: "generated" | "in_progress" | "scored";
  scoredAt: string | null;
  totalCorrect: number | null;
  totalAttempted: number | null;
  verifiedCount: number;
  flaggedCount: number;
};

export default function WorksheetsIndexPage() {
  const [rows, setRows] = useState<WorksheetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/worksheets")
      .then((r) => r.json())
      .then((data) => {
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <header className="mb-10">
        <h2
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Worksheets
        </h2>
        <p className="text-muted-foreground mt-2 font-light">
          Generated practice worksheets across all lessons. Open one to print or
          enter scores.
        </p>
      </header>

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-muted/50 animate-pulse"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3">
          {rows.map((w) => (
            <WorksheetCard key={w.id} worksheet={w} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorksheetCard({ worksheet }: { worksheet: WorksheetRow }) {
  const verified = Number(worksheet.verifiedCount) || 0;
  const flagged = Number(worksheet.flaggedCount) || 0;
  const created = new Date(worksheet.createdAt);
  return (
    <Link href={`/worksheets/${worksheet.id}`} className="block group">
      <div className="relative border border-border rounded-lg px-6 py-5 bg-card hover:bg-accent/50 transition-all duration-200 hover:border-primary/20 hover:shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-5 min-w-0">
            <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/8 text-primary border border-primary/10 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                {worksheet.title}
              </h3>
              <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                <span>
                  Lesson {worksheet.lessonNumber} · {worksheet.lessonTitle}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatRelative(created)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Badge variant="outline" className="text-[10px] capitalize">
              {worksheet.difficultyLevel}
            </Badge>
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {verified}
            </span>
            {flagged > 0 && (
              <span className="flex items-center gap-1 text-xs text-warning">
                <AlertTriangle className="w-3.5 h-3.5" />
                {flagged}
              </span>
            )}
            {worksheet.status === "scored" && (
              <Badge variant="default">Scored</Badge>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 border border-dashed border-border rounded-lg bg-muted/20">
      <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
      <h3
        className="text-lg text-foreground mb-2"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        No worksheets yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto font-light">
        Open a classified lesson and click &ldquo;Generate worksheet&rdquo; to
        create one.
      </p>
    </div>
  );
}

function formatRelative(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
