"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen,
  Image,
  Clock,
  ChevronRight,
  Trash2,
  Sparkles,
  Loader2,
} from "lucide-react";
import { classifyLessonAction } from "@/lib/actions/lessons";

type Lesson = {
  id: number;
  lessonNumber: number;
  title: string;
  gradeLevel: number | null;
  scrapedAt: string;
  totalProblems: number;
  imageProblemsCount: number;
  classificationStatus: "pending" | "in_progress" | "completed";
};

type PendingDelete = { id: number; lessonNumber: number } | null;

export default function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleting, setDeleting] = useState(false);
  const [classifyingIds, setClassifyingIds] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();

  const fetchLessons = () => {
    setLoading(true);
    fetch("/api/lessons")
      .then((r) => r.json())
      .then((data) => {
        setLessons(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchLessons();
  }, []);

  const handleClassify = (lessonId: number) => {
    setClassifyingIds((prev) => new Set(prev).add(lessonId));
    startTransition(async () => {
      const result = await classifyLessonAction(lessonId);
      setClassifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(lessonId);
        return next;
      });
      if (!result.ok) {
        alert(`Couldn't classify lesson: ${result.error}`);
      }
      fetchLessons();
    });
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lessons/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      setPendingDelete(null);
      fetchLessons();
    } catch (err) {
      console.error("Delete failed", err);
      alert(
        err instanceof Error
          ? `Couldn't delete lesson: ${err.message}`
          : "Couldn't delete lesson."
      );
    } finally {
      setDeleting(false);
    }
  };

  const grouped = groupByGrade(lessons);

  return (
    <div>
      <header className="mb-10">
        <h2
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Lessons
        </h2>
        <p className="text-muted-foreground mt-2 font-light">
          Imported homework lessons. Select a lesson to view problems or
          generate practice worksheets.
        </p>
      </header>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-muted/50 animate-pulse"
            />
          ))}
        </div>
      ) : lessons.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-10">
          {grouped.map(({ key, label, lessons: groupLessons }) => (
            <section key={key}>
              <div className="mb-4 flex items-baseline justify-between">
                <h3
                  className="text-lg text-foreground"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {label}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {groupLessons.length}{" "}
                  {groupLessons.length === 1 ? "lesson" : "lessons"}
                </span>
              </div>
              <div className="grid gap-3">
                {groupLessons.map((lesson, i) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={lesson}
                    index={i}
                    isClassifying={classifyingIds.has(lesson.id)}
                    onClassifyClick={() => handleClassify(lesson.id)}
                    onDeleteClick={() =>
                      setPendingDelete({
                        id: lesson.id,
                        lessonNumber: lesson.lessonNumber,
                      })
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete Lesson {pendingDelete?.lessonNumber}?
            </DialogTitle>
            <DialogDescription>
              This removes the lesson, all of its imported problems, every
              worksheet generated from it, and all scoring history. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete lesson"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LessonCard({
  lesson,
  index,
  isClassifying,
  onClassifyClick,
  onDeleteClick,
}: {
  lesson: Lesson;
  index: number;
  isClassifying: boolean;
  onClassifyClick: () => void;
  onDeleteClick: () => void;
}) {
  const date = new Date(lesson.scrapedAt);
  const relativeDate = formatRelative(date);
  const textProblems = lesson.totalProblems - lesson.imageProblemsCount;

  const statusConfig = {
    pending: { label: "Unclassified", variant: "secondary" as const },
    in_progress: { label: "Classifying...", variant: "outline" as const },
    completed: { label: "Classified", variant: "default" as const },
  };

  const isInFlight =
    isClassifying || lesson.classificationStatus === "in_progress";
  const showClassifyButton =
    lesson.classificationStatus === "pending" || isInFlight;
  const status = statusConfig[lesson.classificationStatus];

  return (
    <div className="relative group">
      <Link href={`/lessons/${lesson.id}`} className="block">
        <div
          className="relative border border-border rounded-lg px-6 py-5 bg-card hover:bg-accent/50 transition-all duration-200 hover:border-primary/20 hover:shadow-sm"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/8 text-primary border border-primary/10">
                <span
                  className="text-lg font-medium tabular-nums"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {lesson.lessonNumber}
                </span>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {lesson.title}
                </h4>
                <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    {textProblems} problems
                  </span>
                  {lesson.imageProblemsCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Image className="w-3 h-3" />
                      {lesson.imageProblemsCount} with images
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {relativeDate}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pr-10">
              {showClassifyButton ? (
                <button
                  type="button"
                  disabled={isInFlight}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isInFlight) onClassifyClick();
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-primary/30 text-primary bg-primary/8 hover:bg-primary/15 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
                >
                  {isInFlight ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Classifying…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      Classify
                    </>
                  )}
                </button>
              ) : (
                <Badge variant={status.variant}>{status.label}</Badge>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDeleteClick();
        }}
        aria-label={`Delete Lesson ${lesson.lessonNumber}`}
        className="absolute top-1/2 right-3 -translate-y-1/2 p-2 rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function groupByGrade(
  lessons: Lesson[]
): { key: string; label: string; lessons: Lesson[] }[] {
  const buckets = new Map<number | "ungraded", Lesson[]>();
  for (const lesson of lessons) {
    const k = lesson.gradeLevel ?? "ungraded";
    const arr = buckets.get(k) ?? [];
    arr.push(lesson);
    buckets.set(k, arr);
  }

  const groups: { key: string; label: string; sort: number; lessons: Lesson[] }[] = [];
  for (const [k, group] of buckets) {
    group.sort((a, b) => b.lessonNumber - a.lessonNumber);
    if (k === "ungraded") {
      groups.push({ key: "ungraded", label: "Ungraded", sort: 1e9, lessons: group });
    } else {
      groups.push({
        key: `grade-${k}`,
        label: `Grade ${k}`,
        sort: -k,
        lessons: group,
      });
    }
  }
  groups.sort((a, b) => a.sort - b.sort);
  return groups.map(({ key, label, lessons }) => ({ key, label, lessons }));
}

function EmptyState() {
  return (
    <div className="text-center py-20 border border-dashed border-border rounded-lg bg-muted/20">
      <BookOpen className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
      <h3
        className="text-lg text-foreground mb-2"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        No lessons yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto font-light">
        Run the lesson importer to add homework lessons.
      </p>
      <pre className="mt-4 inline-block text-xs bg-muted px-4 py-2 rounded-md text-muted-foreground font-mono">
        uv run python scrape.py ingest 32 --dry
      </pre>
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
