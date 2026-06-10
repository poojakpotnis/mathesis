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
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen, ChevronRight } from "lucide-react";

type Lesson = {
  id: number;
  lessonNumber: number;
  title: string;
  totalProblems: number;
  classificationStatus: "pending" | "in_progress" | "completed";
};

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

        <div className="space-y-1.5 py-2 max-h-96 overflow-y-auto">
          {lessons === null ? (
            <div className="space-y-2">
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
          ) : (
            eligible.map((l) => (
              <button
                key={l.id}
                onClick={() => pickLesson(l.id)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-accent/50 hover:border-primary/30 transition-colors group"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/8 text-primary text-sm font-medium tabular-nums shrink-0">
                  {l.lessonNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {l.title}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <BookOpen className="w-3 h-3" />
                    {l.totalProblems} problems
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
