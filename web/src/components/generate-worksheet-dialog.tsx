"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { generateWorksheetAction } from "@/lib/actions/worksheets";

type Concept = {
  id: number;
  displayName: string;
  category: string;
  description: string | null;
  problemCount: number;
  exampleProblems: string[];
};

type Difficulty = "easier" | "match" | "harder" | "progressive";

const DIFFICULTIES: { value: Difficulty; label: string; help: string }[] = [
  { value: "easier", label: "Easier", help: "Smaller numbers, simpler steps" },
  { value: "match", label: "Match", help: "Same difficulty as the lesson" },
  { value: "harder", label: "Harder", help: "Larger numbers, more steps" },
  { value: "progressive", label: "Progressive", help: "Ramps up across the worksheet" },
];

export function GenerateWorksheetDialog({
  lessonId,
  concepts,
}: {
  lessonId: number;
  concepts: Concept[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("match");
  const [focusIds, setFocusIds] = useState<Set<number>>(new Set());
  const [skipIds, setSkipIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleExpand(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  }

  function toggleFocus(id: number) {
    const next = new Set(focusIds);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      const nextSkip = new Set(skipIds);
      nextSkip.delete(id);
      setSkipIds(nextSkip);
    }
    setFocusIds(next);
  }

  function toggleSkip(id: number) {
    const next = new Set(skipIds);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      const nextFocus = new Set(focusIds);
      nextFocus.delete(id);
      setFocusIds(nextFocus);
    }
    setSkipIds(next);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await generateWorksheetAction({
        lessonId,
        count,
        difficulty,
        focusConceptIds: focusIds.size > 0 ? [...focusIds] : undefined,
        skipConceptIds: skipIds.size > 0 ? [...skipIds] : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(`/worksheets/${result.worksheetId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Sparkles className="w-4 h-4" />
            Generate worksheet
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate practice worksheet</DialogTitle>
          <DialogDescription>
            Generation takes ~2–3 minutes. Opus drafts the problems, then a
            second Opus pass verifies each answer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Problem count
              </label>
              <Input
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) {
                    setCount(Math.max(1, Math.min(30, n)));
                  }
                }}
                disabled={pending}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Difficulty
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                disabled={pending}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label} — {d.help}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {concepts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Concepts
                </label>
                <span className="text-[10px] text-muted-foreground">
                  Focus = generator prioritizes · Skip = excluded
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {concepts.map((c) => {
                  const isFocus = focusIds.has(c.id);
                  const isSkip = skipIds.has(c.id);
                  const isExpanded = expandedIds.has(c.id);
                  const canExpand = c.exampleProblems.length > 0;
                  return (
                    <div key={c.id} className="text-sm">
                      <div className="flex items-start gap-3 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => canExpand && toggleExpand(c.id)}
                          disabled={!canExpand}
                          className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-default"
                          aria-label={isExpanded ? "Collapse examples" : "Show examples"}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.displayName}</span>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-normal capitalize"
                            >
                              {c.category}
                            </Badge>
                          </div>
                          {c.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              {c.description}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                            Covers {c.problemCount}{" "}
                            {c.problemCount === 1 ? "problem" : "problems"} in this lesson
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0 pt-0.5">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                            <Checkbox
                              checked={isFocus}
                              onCheckedChange={() => toggleFocus(c.id)}
                              disabled={pending}
                            />
                            Focus
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                            <Checkbox
                              checked={isSkip}
                              onCheckedChange={() => toggleSkip(c.id)}
                              disabled={pending}
                            />
                            Skip
                          </label>
                        </div>
                      </div>
                      {isExpanded && canExpand && (
                        <div className="px-3 pb-3 pl-10 bg-muted/30">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                            Examples from this lesson
                          </p>
                          <ul className="space-y-1">
                            {c.exampleProblems.map((text, i) => (
                              <li
                                key={i}
                                className="text-xs text-foreground/80 leading-relaxed"
                              >
                                • {text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
