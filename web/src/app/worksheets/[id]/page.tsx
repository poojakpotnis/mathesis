"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Printer,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Sparkles,
  Download,
  XCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  deleteWorksheetAction,
  setProblemVerificationAction,
  submitScoreAction,
  type ProblemVerificationStatus,
} from "@/lib/actions/worksheets";

type Concept = {
  id: number;
  name: string;
  displayName: string;
  category: string;
};

type ProblemScore = {
  isCorrect: boolean;
  parentNotes: string | null;
  scoredAt: string;
};

type GeneratedProblem = {
  id: number;
  worksheetId: number;
  displayOrder: number;
  problemText: string;
  problemLatex: string | null;
  figureSvg: string | null;
  correctAnswer: string;
  answerFormatType: string;
  solutionSteps: string | null;
  difficultyRating: number | null;
  sourceScrapedProblemId: number | null;
  verificationStatus: ProblemVerificationStatus;
  verificationDetails: string | null;
  concepts: Concept[];
  score: ProblemScore | null;
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
          <DeleteWorksheetButton
            worksheetId={worksheet.id}
            worksheetTitle={worksheet.title}
          />
        </div>
      </div>

      <header className="mb-8 print:mb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">
          Worksheet #{worksheet.id}
        </p>
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
          <TabsTrigger value="score">Score</TabsTrigger>
        </TabsList>

        <TabsContent value="worksheet" className="mt-6 print:mt-0">
          <Separator className="mb-6 print:hidden" />
          {/* Tighter vertical rhythm when printing so 15 problems fit on one
              sheet (front + back). On-screen spacing is unchanged. */}
          <div className="space-y-4 print:space-y-2">
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

        <TabsContent value="score" className="mt-6">
          <Separator className="mb-6 print:hidden" />
          <ScoreSummary
            problems={problems}
            worksheetStatus={worksheet.status}
            scoredAt={worksheet.scoredAt}
          />
          <div className="space-y-4 mt-6">
            {problems.map((p) => (
              <ScoreProblem
                key={p.id}
                problem={p}
                onScored={(score) => {
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          problems: prev.problems.map((q) =>
                            q.id === p.id ? { ...q, score } : q
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

function DeleteWorksheetButton({
  worksheetId,
  worksheetTitle,
}: {
  worksheetId: number;
  worksheetTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteWorksheetAction(worksheetId);
      if (res.ok) {
        setOpen(false);
        router.push("/worksheets");
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
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this worksheet?</DialogTitle>
          <DialogDescription>
            {worksheetTitle} — all generated problems, scores, and parent
            notes for this worksheet will be removed. Concept mastery
            recomputes from remaining scores. Cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {pending ? "Deleting…" : "Delete worksheet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScoreSummary({
  problems,
  worksheetStatus,
  scoredAt,
}: {
  problems: GeneratedProblem[];
  worksheetStatus: string;
  scoredAt: string | null;
}) {
  const scored = problems.filter((p) => p.score !== null).length;
  const correct = problems.filter((p) => p.score?.isCorrect).length;
  const remaining = problems.length - scored;
  const isComplete = worksheetStatus === "scored";
  const accuracy = scored > 0 ? Math.round((correct / scored) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 print:hidden">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Progress
          </p>
          <p className="text-2xl text-foreground mt-1 tabular-nums">
            {scored} <span className="text-muted-foreground text-base">/ {problems.length} scored</span>
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Correct
          </p>
          <p className="text-2xl text-success mt-1 tabular-nums">
            {correct}
            <span className="text-muted-foreground text-base"> ({accuracy}%)</span>
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          {isComplete ? (
            <Badge className="mt-2" variant="default">
              Complete
            </Badge>
          ) : remaining === 0 ? (
            <Badge className="mt-2" variant="default">
              All scored
            </Badge>
          ) : (
            <Badge className="mt-2" variant="outline">
              {remaining} left
            </Badge>
          )}
          {scoredAt && (
            <p className="text-[11px] text-muted-foreground mt-1">
              last update {new Date(scoredAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreProblem({
  problem,
  onScored,
}: {
  problem: GeneratedProblem;
  onScored: (score: ProblemScore) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(problem.score?.parentNotes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [savedNotes, setSavedNotes] = useState(
    problem.score?.parentNotes ?? ""
  );
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function submit(isCorrect: boolean, opts?: { fromNotesAutoSave?: boolean }) {
    if (opts?.fromNotesAutoSave) setNotesStatus("saving");
    startTransition(async () => {
      const trimmed = notes.trim();
      const res = await submitScoreAction(
        problem.worksheetId,
        problem.id,
        isCorrect,
        trimmed || undefined
      );
      if (res.ok) {
        onScored({
          isCorrect,
          parentNotes: trimmed || null,
          scoredAt: new Date().toISOString(),
        });
        setSavedNotes(trimmed);
        if (opts?.fromNotesAutoSave) {
          setNotesStatus("saved");
          if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
          savedFlashTimer.current = setTimeout(
            () => setNotesStatus("idle"),
            1500
          );
        }
      } else if (opts?.fromNotesAutoSave) {
        setNotesStatus("idle");
      }
    });
  }

  const score = problem.score;
  const correctBtnActive = score?.isCorrect === true;
  const wrongBtnActive = score?.isCorrect === false;
  const notesDirty = notes.trim() !== savedNotes.trim();
  const [editingScore, setEditingScore] = useState(false);
  const showButtons = !score || editingScore;

  // Debounced auto-save: 800ms after the last keystroke, push the current
  // notes back via the score action. Only fires when the problem already
  // has a score (notes attach to the score row) and only when the text
  // differs from what's persisted.
  useEffect(() => {
    if (!score) return;
    if (!notesDirty) return;
    if (pending) return;
    const timer = setTimeout(() => {
      submit(score.isCorrect, { fromNotesAutoSave: true });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, score?.isCorrect, notesDirty, pending]);

  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    };
  }, []);

  return (
    <div
      className={`border rounded-lg px-5 py-4 ${
        score
          ? score.isCorrect
            ? "border-success/30 bg-success/5"
            : "border-destructive/30 bg-destructive/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-1.5 min-w-[1.75rem] pt-0.5">
          <span
            className="text-sm font-medium text-primary/70 tabular-nums"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {problem.displayOrder}.
          </span>
          {score && (
            score.isCorrect ? (
              <CheckCircle2
                className="w-5 h-5 text-success shrink-0"
                fill="currentColor"
                fillOpacity={0.15}
                strokeWidth={2.5}
                aria-label="Correct"
              />
            ) : (
              <XCircle
                className="w-5 h-5 text-destructive shrink-0"
                fill="currentColor"
                fillOpacity={0.15}
                strokeWidth={2.5}
                aria-label="Wrong"
              />
            )
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {problem.problemText}
          </p>
          <FigureSvg svg={problem.figureSvg} />

          <div className="mt-3 text-sm">
            <span className="text-xs uppercase tracking-wider text-muted-foreground mr-2">
              Answer
            </span>
            <span className="font-medium text-foreground">
              {problem.correctAnswer}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {showButtons ? (
              <>
                <Button
                  size="xs"
                  variant={correctBtnActive ? "default" : "outline"}
                  onClick={() => {
                    submit(true);
                    setEditingScore(false);
                  }}
                  disabled={pending}
                  className={correctBtnActive ? "bg-success hover:bg-success/90 text-white" : ""}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Correct
                </Button>
                <Button
                  size="xs"
                  variant={wrongBtnActive ? "default" : "outline"}
                  onClick={() => {
                    submit(false);
                    setEditingScore(false);
                  }}
                  disabled={pending}
                  className={wrongBtnActive ? "bg-destructive hover:bg-destructive/90 text-white" : ""}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Wrong
                </Button>
                {score && editingScore && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditingScore(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                )}
              </>
            ) : (
              <>
                <Badge
                  variant="outline"
                  className={`text-[11px] gap-1 ${
                    score?.isCorrect
                      ? "border-success/40 text-success bg-success/10"
                      : "border-destructive/40 text-destructive bg-destructive/10"
                  }`}
                >
                  {score?.isCorrect ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {score?.isCorrect ? "Correct" : "Wrong"}
                </Badge>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setEditingScore(true)}
                  disabled={pending}
                  className="text-muted-foreground"
                >
                  Change
                </Button>
              </>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setNotesOpen((v) => !v)}
            >
              <Pencil className="w-3.5 h-3.5" />
              {notes ? "Notes ✓" : "Notes"}
            </Button>
            {score && (
              <span className="text-[11px] text-muted-foreground ml-auto">
                {new Date(score.scoredAt).toLocaleString()}
              </span>
            )}
          </div>

          {notesOpen && (
            <div className="mt-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  score
                    ? "What did your kid struggle with? (saves automatically)"
                    : "Score this problem first to enable notes."
                }
                disabled={!score}
                className="w-full min-h-[60px] rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
              <div className="mt-1 h-4 text-[11px] flex items-center gap-2">
                {!score ? null : notesStatus === "saving" ? (
                  <span className="text-muted-foreground">Saving…</span>
                ) : notesStatus === "saved" ? (
                  <span className="text-success">Saved ✓</span>
                ) : notesDirty ? (
                  <span className="text-muted-foreground">
                    Unsaved · saves automatically when you stop typing
                  </span>
                ) : savedNotes ? (
                  <span className="text-muted-foreground">Saved earlier</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Renders a generated figure. The SVG is loaded through an <img> data URI
// rather than injected inline: an <img>-loaded SVG is an isolated document
// that cannot run scripts or fetch external resources, so no sanitization is
// needed. White background so the model's dark strokes read regardless of the
// page theme (and matches how it will print). Null figure renders nothing.
function FigureSvg({ svg }: { svg: string | null }) {
  if (!svg) return null;
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <div className="mt-3 inline-block rounded-md border border-border bg-white p-3">
      {/* Explicit width is required: the SVG has a viewBox but no intrinsic
          width/height, so an <img> with auto width collapses to nothing. With a
          fixed width the browser derives height from the viewBox aspect ratio.
          A data-URI SVG can't run scripts, and next/image can't optimize it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Figure for this problem"
        width={280}
        className="block h-auto w-[280px] max-w-full"
      />
    </div>
  );
}

function WorksheetProblem({ problem }: { problem: GeneratedProblem }) {
  return (
    <div className="border border-border rounded-lg px-5 py-4 bg-card print:py-2.5 print:break-inside-avoid">
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
          <FigureSvg svg={problem.figureSvg} />
          <div className="mt-3 h-8 border-b border-dashed border-border print:mt-2 print:h-6" />
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
          <FigureSvg svg={problem.figureSvg} />

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
