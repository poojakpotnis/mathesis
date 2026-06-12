"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Sparkles, BookOpen, FileText } from "lucide-react";
import { generateConceptWorksheetAction } from "@/lib/actions/worksheets";

const COUNT_OPTIONS = [4, 6, 8, 10, 12];
const DEFAULT_COUNT = 8;

type MasteryLevel = "not_started" | "learning" | "practicing" | "mastered";
type ModalityTag = "text_dominant" | "mixed" | "visual_dominant";

type ConceptRow = {
  id: number;
  name: string;
  displayName: string;
  category: string;
  description: string | null;
  createdBy: "claude" | "parent";
  modalityTag: ModalityTag;
  sourceProblemCount: number;
  lessonCount: number;
  generatedProblemCount: number;
  mastery: {
    level: MasteryLevel;
    totalAttempted: number;
    totalCorrect: number;
    currentStreak: number;
    lastAttemptedAt: string | null;
  } | null;
  examples: { problemNumber: string; problemText: string }[];
};

export default function ConceptsPage() {
  const [rows, setRows] = useState<ConceptRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/concepts")
      .then((r) => r.json())
      .then((d) => {
        setRows(d.concepts);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-72 bg-muted/50 animate-pulse rounded" />
        <div className="h-6 w-96 bg-muted/50 animate-pulse rounded" />
        <div className="space-y-3 mt-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return <p className="text-muted-foreground">No concepts yet.</p>;
  }

  const byCategory = new Map<string, ConceptRow[]>();
  for (const r of rows) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }
  const categories = [...byCategory.keys()].sort();

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <header className="mb-10">
        <h2
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Concepts
        </h2>
        <p className="text-muted-foreground mt-2 font-light">
          The taxonomy used to classify problems and generate worksheets.{" "}
          {rows.length} concepts across {categories.length} categories.
        </p>
      </header>

      <div className="space-y-10">
        {categories.map((cat) => {
          const items = byCategory.get(cat) ?? [];
          return (
            <section key={cat}>
              <h3
                className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {cat} <span className="text-muted-foreground/60">· {items.length}</span>
              </h3>
              <div className="grid gap-2">
                {items.map((c) => (
                  <ConceptCard
                    key={c.id}
                    row={c}
                    expanded={expanded.has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ConceptCard({
  row,
  expanded,
  onToggle,
}: {
  row: ConceptRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 pr-3 hover:bg-accent/30 transition-colors">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-4 px-5 py-4 text-left min-w-0"
        >
          <div className="text-muted-foreground">
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">
                {row.displayName}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                {row.name}
              </span>
              {row.mastery && row.mastery.totalAttempted > 0 && (
                <MasteryBadge level={row.mastery.level} />
              )}
              {row.modalityTag === "visual_dominant" && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-muted-foreground/30 text-muted-foreground"
                >
                  visual
                </Badge>
              )}
              {row.createdBy === "parent" && (
                <Badge variant="outline" className="text-[10px]">
                  parent
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <BookOpen className="w-3 h-3" />
                {row.sourceProblemCount} source problem
                {row.sourceProblemCount === 1 ? "" : "s"}
                {row.lessonCount > 0 && ` · ${row.lessonCount} lesson${row.lessonCount === 1 ? "" : "s"}`}
              </span>
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {row.generatedProblemCount} generated
              </span>
              {row.mastery && row.mastery.totalAttempted > 0 && (
                <span className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  {row.mastery.totalCorrect}/{row.mastery.totalAttempted}{" "}
                  ({Math.round(
                    (row.mastery.totalCorrect / row.mastery.totalAttempted) * 100
                  )}
                  %)
                </span>
              )}
            </div>
          </div>
        </button>
        <ConceptDrillButton row={row} />
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 bg-muted/10">
          {row.description ? (
            <p className="text-sm text-foreground/80 leading-relaxed">
              {row.description}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No description recorded for this concept.
            </p>
          )}

          {row.examples.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Example source problems
              </p>
              <ul className="space-y-2">
                {row.examples.map((ex, i) => (
                  <li
                    key={i}
                    className="text-sm text-foreground/80 flex gap-3 items-start"
                  >
                    <span className="text-[11px] font-mono text-muted-foreground min-w-[2.5rem] pt-0.5">
                      {ex.problemNumber}
                    </span>
                    <span className="whitespace-pre-wrap">{ex.problemText}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConceptDrillButton({ row }: { row: ConceptRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const disabled =
    row.modalityTag === "visual_dominant" || row.sourceProblemCount === 0;
  const title =
    row.modalityTag === "visual_dominant"
      ? "Taught with diagrams — use the portal directly"
      : row.sourceProblemCount === 0
        ? "No source problems to drill from"
        : `Generate a progressive worksheet on ${row.displayName}`;

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const res = await generateConceptWorksheetAction(row.id, count);
      if (res.ok) {
        setOpen(false);
        router.push(`/worksheets/${res.worksheetId}`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            title={title}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Drill {row.displayName}</DialogTitle>
          <DialogDescription>
            Progressive worksheet — problems ramp from easier to harder. Pulls
            from {row.sourceProblemCount} source problem
            {row.sourceProblemCount === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            How many problems?
          </label>
          <div className="flex items-center gap-2 mt-2">
            {COUNT_OPTIONS.map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={count === n ? "default" : "outline"}
                onClick={() => setCount(n)}
                disabled={pending}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={pending}>
            {pending ? "Generating…" : `Generate ${count} problems`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MasteryBadge({ level }: { level: MasteryLevel }) {
  const config: Record<MasteryLevel, { label: string; className: string }> = {
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
