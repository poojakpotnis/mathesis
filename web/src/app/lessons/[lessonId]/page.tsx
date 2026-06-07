"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ImageIcon,
  FileText,
  Sparkles,
} from "lucide-react";

type Concept = {
  id: number;
  name: string;
  displayName: string;
  category: string;
  confidence: number;
};

type Problem = {
  id: number;
  problemNumber: string;
  displayOrder: number;
  problemText: string;
  isTakeHome: boolean;
  hasImage: boolean;
  imageDescription: string | null;
  hintText: string | null;
  answerFormatType: string | null;
  creditStatus: string | null;
  concepts: Concept[];
};

type Lesson = {
  id: number;
  lessonNumber: number;
  title: string;
  scrapedAt: string;
  totalProblems: number;
  imageProblemsCount: number;
  classificationStatus: string;
};

type LessonDetail = {
  lesson: Lesson;
  problems: Problem[];
};

export default function LessonDetailPage() {
  const params = useParams();
  const [data, setData] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/lessons/${params.lessonId}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.lessonId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted/50 animate-pulse rounded" />
        <div className="h-6 w-96 bg-muted/50 animate-pulse rounded" />
        <div className="space-y-3 mt-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-muted/50 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground">Lesson not found.</p>;
  }

  const { lesson, problems } = data;
  const textProblems = problems.filter((p) => !p.hasImage);
  const imageProblems = problems.filter((p) => p.hasImage);
  const allConcepts = Array.from(
    new Map(
      problems
        .flatMap((p) => p.concepts)
        .map((c) => [c.id, c])
    ).values()
  );

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All Lessons
      </Link>

      <header className="mb-8">
        <h2
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {lesson.title}
        </h2>
        <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            {textProblems.length} text problems
          </span>
          {imageProblems.length > 0 && (
            <span className="flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4" />
              {imageProblems.length} image problems (skipped for generation)
            </span>
          )}
          {allConcepts.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              {allConcepts.length} concepts identified
            </span>
          )}
        </div>
      </header>

      {allConcepts.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 font-medium">
            Concepts in this lesson
          </h3>
          <div className="flex flex-wrap gap-2">
            {allConcepts.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-xs font-normal">
                {c.displayName}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Separator className="mb-8" />

      <div className="space-y-3">
        {problems.map((problem) => (
          <ProblemCard key={problem.id} problem={problem} />
        ))}
      </div>
    </div>
  );
}

function ProblemCard({ problem }: { problem: Problem }) {
  return (
    <div
      className={`border rounded-lg px-5 py-4 transition-colors ${
        problem.hasImage
          ? "border-border/50 bg-muted/30 opacity-70"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className="text-sm font-medium text-primary/70 min-w-[2.5rem] pt-0.5 tabular-nums"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {problem.problemNumber}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed">
            {problem.problemText}
          </p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {problem.hasImage && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <ImageIcon className="w-3 h-3" />
                Has image
              </Badge>
            )}
            {problem.isTakeHome && (
              <Badge variant="outline" className="text-[10px]">
                Take Home
              </Badge>
            )}
            {problem.answerFormatType && (
              <Badge variant="secondary" className="text-[10px]">
                {problem.answerFormatType}
              </Badge>
            )}
            {problem.creditStatus && (
              <Badge
                variant={problem.creditStatus === "full" ? "default" : "secondary"}
                className="text-[10px]"
              >
                {problem.creditStatus === "full"
                  ? "Full credit"
                  : problem.creditStatus === "partial"
                  ? "Partial credit"
                  : problem.creditStatus}
              </Badge>
            )}
            {problem.concepts.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-[10px] font-normal">
                {c.displayName}
              </Badge>
            ))}
          </div>

          {problem.hintText && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              Hint: {problem.hintText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
