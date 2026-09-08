"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen, ChevronRight } from "lucide-react";

type Lesson = {
  id: number;
  lessonNumber: number;
  title: string;
  gradeLevel: number | null;
  totalProblems: number;
  classificationStatus: "pending" | "in_progress" | "completed";
};

function gradeTabValue(grade: number | null): string {
  return grade == null ? "ungraded" : `g${grade}`;
}

function gradeTabLabel(grade: number | null): string {
  if (grade == null) return "Ungraded";
  const suffix = grade === 1 ? "st" : grade === 2 ? "nd" : grade === 3 ? "rd" : "th";
  return `${grade}${suffix} grade`;
}

export function QuickGenerateButton({
  variant = "default",
}: {
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);

  useEffect(() => {
    if (open && lessons === null) {
      fetch("/api/lessons")
        .then((r) => r.json())
        .then((data: Lesson[]) => setLessons(data))
        .catch(() => setLessons([]));
    }
  }, [open, lessons]);

  function pickLesson(lessonId: number) {
    setOpen(false);
    router.push(`/lessons/${lessonId}?generate=1`);
  }

  const eligible = (lessons ?? []).filter(
    (l) => l.classificationStatus === "completed"
  );

  // Group eligible lessons by grade so the picker can tab between grades.
  // Highest grade wins the default tab (that's the current cohort; older
  // grades are archived material the parent still occasionally revisits).
  const byGrade = new Map<number | null, Lesson[]>();
  for (const l of eligible) {
    const key = l.gradeLevel;
    const bucket = byGrade.get(key);
    if (bucket) bucket.push(l);
    else byGrade.set(key, [l]);
  }
  const gradeKeys = Array.from(byGrade.keys()).sort((a, b) => {
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  });
  const defaultTab = gradeKeys.length ? gradeTabValue(gradeKeys[0]) : "g5";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={variant}>
            <Sparkles className="w-4 h-4" />
            Generate worksheet
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which lesson?</DialogTitle>
          <DialogDescription>
            Practice problems are modeled after a source lesson&apos;s problems.
            Pick one to continue.
          </DialogDescription>
        </DialogHeader>

        {lessons === null ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-muted/50 animate-pulse rounded-md"
              />
            ))}
          </div>
        ) : eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No classified lessons yet. Import and classify a lesson first.
          </p>
        ) : gradeKeys.length <= 1 ? (
          <div className="space-y-1.5 py-2 max-h-96 overflow-y-auto min-w-0">
            {eligible.map((l) => (
              <LessonRow key={l.id} lesson={l} onPick={pickLesson} />
            ))}
          </div>
        ) : (
          // min-w-0 is load-bearing: DialogContent is a grid, and grid items
          // default to min-width: min-content. Grade-5 lesson titles are long
          // enough that without this, the row's intrinsic width blows the
          // whole dialog past sm:max-w-md.
          <Tabs defaultValue={defaultTab} className="min-w-0">
            <TabsList>
              {gradeKeys.map((g) => (
                <TabsTrigger key={gradeTabValue(g)} value={gradeTabValue(g)}>
                  {gradeTabLabel(g)} ({byGrade.get(g)!.length})
                </TabsTrigger>
              ))}
            </TabsList>
            {gradeKeys.map((g) => (
              <TabsContent
                key={gradeTabValue(g)}
                value={gradeTabValue(g)}
                className="mt-3 min-w-0"
              >
                <div className="space-y-1.5 max-h-96 overflow-y-auto min-w-0">
                  {byGrade.get(g)!.map((l) => (
                    <LessonRow key={l.id} lesson={l} onPick={pickLesson} />
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LessonRow({
  lesson,
  onPick,
}: {
  lesson: Lesson;
  onPick: (lessonId: number) => void;
}) {
  return (
    <button
      onClick={() => onPick(lesson.id)}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-accent/50 hover:border-primary/30 transition-colors group"
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/8 text-primary text-sm font-medium tabular-nums shrink-0">
        {lesson.lessonNumber}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {lesson.title}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
          <BookOpen className="w-3 h-3" />
          {lesson.totalProblems} problems
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
    </button>
  );
}
