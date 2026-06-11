"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  FileText,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  Clock,
  ChevronRight,
} from "lucide-react";
import { QuickGenerateButton } from "@/components/quick-generate-button";

type MasteryLevel = "not_started" | "learning" | "practicing" | "mastered";

type MasteryRow = {
  conceptId: number;
  name: string;
  displayName: string;
  category: string;
  totalAttempted: number;
  totalCorrect: number;
  currentStreak: number;
  lastAttemptedAt: string | null;
  masteryLevel: MasteryLevel;
  accuracy: number;
};

type RecentWorksheet = {
  id: number;
  title: string;
  lessonId: number;
  lessonNumber: number;
  lessonTitle: string;
  createdAt: string;
  scoredAt: string | null;
  status: string;
  totalProblems: number;
  totalAttempted: number | null;
  totalCorrect: number | null;
  difficultyLevel: string;
};

type DashboardData = {
  summary: {
    totalWorksheets: number;
    scoredWorksheets: number;
    totalAttempted: number;
    totalCorrect: number;
    overallAccuracy: number;
  };
  mastery: MasteryRow[];
  recentWorksheets: RecentWorksheet[];
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-72 bg-muted/50 animate-pulse rounded" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="h-96 bg-muted/50 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground">Dashboard unavailable.</p>;
  }

  return (
    <div>
      <header className="mb-10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2
            className="text-3xl tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Dashboard
          </h2>
          <p className="text-muted-foreground mt-2 font-light">
            Practice activity and concept mastery overview.
          </p>
        </div>
        <QuickGenerateButton />
      </header>

      <SummaryGrid
        summary={data.summary}
        conceptsTouched={data.mastery.filter((m) => m.totalAttempted > 0).length}
        conceptsTotal={data.mastery.length}
      />

      <section className="mt-12">
        <SectionHeading>Concept mastery</SectionHeading>
        <MasteryTable rows={data.mastery} />
      </section>

      <section className="mt-12">
        <SectionHeading>Recent worksheets</SectionHeading>
        <RecentWorksheets rows={data.recentWorksheets} />
      </section>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-lg tracking-tight text-foreground mb-4"
      style={{ fontFamily: "var(--font-heading)" }}
    >
      {children}
    </h3>
  );
}

function SummaryGrid({
  summary,
  conceptsTouched,
  conceptsTotal,
}: {
  summary: DashboardData["summary"];
  conceptsTouched: number;
  conceptsTotal: number;
}) {
  const accuracyPct = Math.round(summary.overallAccuracy * 100);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Stat
        icon={FileText}
        label="Worksheets"
        value={`${summary.scoredWorksheets} / ${summary.totalWorksheets}`}
        sub="scored"
      />
      <Stat
        icon={CheckCircle2}
        label="Problems attempted"
        value={String(summary.totalAttempted)}
      />
      <Stat
        icon={TrendingUp}
        label="Overall accuracy"
        value={summary.totalAttempted > 0 ? `${accuracyPct}%` : "—"}
        sub={
          summary.totalAttempted > 0
            ? `${summary.totalCorrect} correct`
            : "no scores yet"
        }
      />
      <Stat
        icon={Sparkles}
        label="Concepts touched"
        value={`${conceptsTouched} / ${conceptsTotal}`}
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border border-border rounded-lg px-5 py-4 bg-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p
        className="text-2xl text-foreground mt-2 tabular-nums"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-1 font-light">{sub}</p>
      )}
    </div>
  );
}

const MASTERY_ORDER: Record<MasteryLevel, number> = {
  mastered: 0,
  practicing: 1,
  learning: 2,
  not_started: 3,
};

function MasteryTable({ rows }: { rows: MasteryRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    if (a.masteryLevel !== b.masteryLevel) {
      return MASTERY_ORDER[a.masteryLevel] - MASTERY_ORDER[b.masteryLevel];
    }
    return b.totalAttempted - a.totalAttempted;
  });

  const touched = sorted.filter((r) => r.totalAttempted > 0);
  const untouched = sorted.filter((r) => r.totalAttempted === 0);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No concepts yet.</p>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/30">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Concept</th>
            <th className="text-left px-4 py-2.5 font-medium">Level</th>
            <th className="text-right px-4 py-2.5 font-medium">Attempts</th>
            <th className="text-right px-4 py-2.5 font-medium">Accuracy</th>
            <th className="text-right px-4 py-2.5 font-medium">Streak</th>
            <th className="text-right px-4 py-2.5 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {touched.map((r) => (
            <MasteryRowView key={r.conceptId} row={r} />
          ))}
          {touched.length > 0 && untouched.length > 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/20"
              >
                Not yet practiced ({untouched.length})
              </td>
            </tr>
          )}
          {untouched.map((r) => (
            <MasteryRowView key={r.conceptId} row={r} dim />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MasteryRowView({ row, dim }: { row: MasteryRow; dim?: boolean }) {
  const accuracyPct =
    row.totalAttempted > 0 ? Math.round(row.accuracy * 100) : null;
  return (
    <tr
      className={`border-t border-border ${dim ? "text-muted-foreground" : ""}`}
    >
      <td className="px-4 py-2.5">
        <div className="font-medium text-foreground">{row.displayName}</div>
        <div className="text-[11px] text-muted-foreground">
          {row.category}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <MasteryBadge level={row.masteryLevel} />
      </td>
      <td className="text-right tabular-nums px-4 py-2.5">
        {row.totalAttempted}
      </td>
      <td className="text-right tabular-nums px-4 py-2.5">
        {accuracyPct !== null ? `${accuracyPct}%` : "—"}
      </td>
      <td className="text-right tabular-nums px-4 py-2.5">
        {row.currentStreak > 0 ? row.currentStreak : "—"}
      </td>
      <td className="text-right text-xs text-muted-foreground px-4 py-2.5">
        {row.lastAttemptedAt
          ? new Date(row.lastAttemptedAt).toLocaleDateString()
          : "—"}
      </td>
    </tr>
  );
}

function MasteryBadge({ level }: { level: MasteryLevel }) {
  const config: Record<
    MasteryLevel,
    { label: string; className: string }
  > = {
    not_started: {
      label: "Not started",
      className: "bg-muted/40 text-muted-foreground border-border",
    },
    learning: {
      label: "Learning",
      className: "bg-warning/10 text-warning border-warning/30",
    },
    practicing: {
      label: "Practicing",
      className: "bg-primary/10 text-primary border-primary/30",
    },
    mastered: {
      label: "Mastered",
      className: "bg-success/10 text-success border-success/30",
    },
  };
  const c = config[level];
  return (
    <Badge variant="outline" className={`text-[10px] ${c.className}`}>
      {c.label}
    </Badge>
  );
}

function RecentWorksheets({ rows }: { rows: RecentWorksheet[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg bg-muted/20 px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">No worksheets yet.</p>
        <p className="text-xs text-muted-foreground mt-1 font-light">
          Generate one from the Lessons page.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((w) => (
        <li key={w.id}>
          <Link
            href={`/worksheets/${w.id}`}
            className="group block border border-border rounded-lg px-5 py-3.5 bg-card hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">
                  <span className="text-muted-foreground tabular-nums mr-1.5">
                    #{w.id}
                  </span>
                  {w.title}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    Lesson {w.lessonNumber}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatRelative(new Date(w.createdAt))}
                  </span>
                  <span>{w.difficultyLevel}</span>
                </div>
              </div>
              <div className="text-right">
                {w.status === "scored" ? (
                  <>
                    <div className="text-sm tabular-nums text-foreground">
                      {w.totalCorrect}/{w.totalProblems}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {Math.round(
                        ((w.totalCorrect ?? 0) / w.totalProblems) * 100
                      )}
                      %
                    </div>
                  </>
                ) : (w.totalAttempted ?? 0) > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    {w.totalAttempted}/{w.totalProblems} scored
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    not scored
                  </Badge>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
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
