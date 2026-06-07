"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Image, Clock, ChevronRight } from "lucide-react";

type Lesson = {
  id: number;
  lessonNumber: number;
  title: string;
  scrapedAt: string;
  totalProblems: number;
  imageProblemsCount: number;
  classificationStatus: "pending" | "in_progress" | "completed";
};

export default function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lessons")
      .then((r) => r.json())
      .then((data) => {
        setLessons(data);
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
          Lessons
        </h2>
        <p className="text-muted-foreground mt-2 font-light">
          Scraped homework lessons from RSM. Select a lesson to view problems or
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
        <div className="grid gap-3">
          {lessons.map((lesson, i) => (
            <LessonCard key={lesson.id} lesson={lesson} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson, index }: { lesson: Lesson; index: number }) {
  const date = new Date(lesson.scrapedAt);
  const relativeDate = formatRelative(date);
  const textProblems = lesson.totalProblems - lesson.imageProblemsCount;

  const statusConfig = {
    pending: { label: "Unclassified", variant: "secondary" as const },
    in_progress: { label: "Classifying...", variant: "outline" as const },
    completed: { label: "Classified", variant: "default" as const },
  };

  const status = statusConfig[lesson.classificationStatus];

  return (
    <Link href={`/lessons/${lesson.id}`} className="block group">
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
              <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                {lesson.title}
              </h3>
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

          <div className="flex items-center gap-3">
            <Badge variant={status.variant}>{status.label}</Badge>
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
      <BookOpen className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
      <h3
        className="text-lg text-foreground mb-2"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        No lessons yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto font-light">
        Run the scraper to import homework lessons from RSM.
      </p>
      <pre className="mt-4 inline-block text-xs bg-muted px-4 py-2 rounded-md text-muted-foreground font-mono">
        python scrape.py scrape 32
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
