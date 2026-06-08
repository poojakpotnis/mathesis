"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ArrowLeft,
  Printer,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Sparkles,
  Download,
} from "lucide-react";
import {
  setProblemVerificationAction,
  type ProblemVerificationStatus,
} from "@/lib/actions/worksheets";

type Concept = {
  id: number;
  name: string;
  displayName: string;
  category: string;
};

type GeneratedProblem = {
  id: number;
  worksheetId: number;
  displayOrder: number;
  problemText: string;
  problemLatex: string | null;
  correctAnswer: string;
  answerFormatType: string;
  solutionSteps: string | null;
  difficultyRating: number | null;
  sourceScrapedProblemId: number | null;
  verificationStatus: ProblemVerificationStatus;
  verificationDetails: string | null;
  concepts: Concept[];
};

type Worksheet = {
  id: number;
  lessonId: number;
  lessonNumber: number;
  lessonTitle: string;
  title: string;
  createdAt: string;
  totalProblems: number;
  difficultyLevel: string;
  status: string;
  scoredAt: string | null;
  totalCorrect: number | null;
  totalAttempted: number | null;
};

type Detail = {
  worksheet: Worksheet;
  problems: GeneratedProblem[];
};

export default function WorksheetDetailPage() {
  const params = useParams();
  const worksheetId = parseInt(String(params.id), 10);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/worksheets/${worksheetId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.worksheet) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [worksheetId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-72 bg-muted/50 animate-pulse rounded" />
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
    return <p className="text-muted-foreground">Worksheet not found.</p>;
  }

  const { worksheet, problems } = data;
  // Parent overrides ("approved" / "confirmed_flagged") roll up with the
  // automated verdicts for the headline counts.
  const verified = problems.filter(
    (p) =>
      p.verificationStatus === "verified" || p.verificationStatus === "approved"
  ).length;
  const flagged = problems.length - verified;

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6 print:hidden">
        <Link
          href="/worksheets"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Worksheets
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/worksheets/${worksheet.id}/pdf`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "outline" })}
          >
            <Download className="w-4 h-4" />
            PDF
          </a>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
            Print
          </Button>
        </div>
      </div>

      <header className="mb-8 print:mb-4">
        <h2
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {worksheet.title}
        </h2>
        <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground flex-wrap">
          <Link
            href={`/lessons/${worksheet.lessonId}`}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <FileText className="w-4 h-4" />
            Lesson {worksheet.lessonNumber} · {worksheet.lessonTitle}
          </Link>
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            {problems.length} problems
          </span>
          <span className="flex items-center gap-1.5 text-success">
            <CheckCircle2 className="w-4 h-4" />
            {verified} verified
          </span>
          {flagged > 0 && (
            <span className="flex items-center gap-1.5 text-warning">
              <AlertTriangle className="w-4 h-4" />
              {flagged} flagged
            </span>
          )}
        </div>
      </header>

      <Tabs defaultValue="worksheet" className="print:block">
        <TabsList className="print:hidden">
          <TabsTrigger value="worksheet">Worksheet</TabsTrigger>
          <TabsTrigger value="answers">Answer key</TabsTrigger>
        </TabsList>

        <TabsContent value="worksheet" className="mt-6">
          <Separator className="mb-6 print:hidden" />
          <div className="space-y-4">
            {problems.map((p) => (
              <WorksheetProblem key={p.id} problem={p} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="answers" className="mt-6">
          <Separator className="mb-6 print:hidden" />
          <div className="space-y-4">
            {problems.map((p) => (
              <AnswerKeyProblem
                key={p.id}
                problem={p}
                onApprove={(status) => {
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          problems: prev.problems.map((q) =>
                            q.id === p.id ? { ...q, verificationStatus: status } : q
                          ),
                        }
                      : prev
                  );
                }}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorksheetProblem({ problem }: { problem: GeneratedProblem }) {
  return (
    <div className="border border-border rounded-lg px-5 py-4 bg-card">
      <div className="flex items-start gap-4">
        <span
          className="text-sm font-medium text-primary/70 min-w-[2.5rem] pt-0.5 tabular-nums"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {problem.displayOrder}.
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {problem.problemText}
          </p>
          <div className="mt-3 h-8 border-b border-dashed border-border" />
        </div>
      </div>
    </div>
  );
}

function AnswerKeyProblem({
  problem,
  onApprove,
}: {
  problem: GeneratedProblem;
  onApprove: (status: ProblemVerificationStatus) => void;
}) {
  const [pending, startTransition] = useTransition();
  const isFlagged =
    problem.verificationStatus === "flagged" ||
    problem.verificationStatus === "confirmed_flagged";
  const isParentReviewed =
    problem.verificationStatus === "approved" ||
    problem.verificationStatus === "confirmed_flagged";

  function setStatus(status: ProblemVerificationStatus) {
    startTransition(async () => {
      const res = await setProblemVerificationAction(
        problem.worksheetId,
        problem.id,
        status
      );
      if (res.ok) onApprove(status);
    });
  }

  return (
    <div
      className={`border rounded-lg px-5 py-4 ${
        isFlagged ? "border-warning/40 bg-warning/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className="text-sm font-medium text-primary/70 min-w-[2.5rem] pt-0.5 tabular-nums"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {problem.displayOrder}.
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {problem.problemText}
          </p>

          <div className="mt-3 grid gap-2 text-sm">
            <div>
              <span className="text-xs uppercase tracking-wider text-muted-foreground mr-2">
                Answer
              </span>
              <span className="font-medium text-foreground">
                {problem.correctAnswer}
              </span>
              <Badge variant="outline" className="ml-2 text-[10px]">
                {problem.answerFormatType}
              </Badge>
            </div>
            {problem.solutionSteps && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
                  Solution steps
                </summary>
                <p className="mt-2 pl-3 border-l border-border whitespace-pre-wrap text-foreground/80">
                  {problem.solutionSteps}
                </p>
              </details>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap print:hidden">
            {isFlagged ? (
              <>
                <Badge
                  variant="outline"
                  className="text-[10px] border-warning/40 text-warning gap-1"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {problem.verificationStatus === "confirmed_flagged"
                    ? "Confirmed flagged"
                    : "Flagged — verifier disagreed"}
                </Badge>
                {problem.verificationStatus === "flagged" && (
                  <>
                    <Button
                      size="xs"
                      onClick={() => setStatus("approved")}
                      disabled={pending}
                    >
                      Approve as correct
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => setStatus("confirmed_flagged")}
                      disabled={pending}
                    >
                      Confirm flagged
                    </Button>
                  </>
                )}
                {problem.verificationStatus === "confirmed_flagged" && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setStatus("flagged")}
                    disabled={pending}
                  >
                    Undo
                  </Button>
                )}
              </>
            ) : (
              <>
                <Badge
                  variant="outline"
                  className="text-[10px] gap-1 text-success border-success/30"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {problem.verificationStatus === "approved"
                    ? "Approved"
                    : "Verified"}
                </Badge>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setStatus("flagged")}
                  disabled={pending}
                >
                  Re-flag
                </Button>
              </>
            )}
            {isParentReviewed && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                parent reviewed
              </Badge>
            )}
            {problem.concepts.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-[10px] font-normal">
                {c.displayName}
              </Badge>
            ))}
          </div>

          {problem.verificationDetails && isFlagged && (
            <details className="mt-2 text-xs text-muted-foreground print:hidden">
              <summary className="cursor-pointer">Verifier notes</summary>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] bg-muted/30 rounded px-2 py-1.5">
                {problem.verificationDetails}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
