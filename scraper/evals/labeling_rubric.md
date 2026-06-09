# Verifier-calibration labeling rubric

Used when a parent reviews a verifier-flagged worksheet problem in the UI
and decides between **`approved`** (verifier was wrong to flag — the answer
is fine) and **`confirmed_flagged`** (verifier was right to flag — the
generated problem genuinely needs rework).

This rubric is the ground truth that `verifier_calibration_eval` scores
against. Inconsistent labeling produces noisy flag-precision numbers and
makes it impossible to tell whether a change moved the verifier or moved
the labeler.

## Default rules

- **`approved`** — the math the verifier did is correct (so the problem is
  legitimately solvable as stated), but the verifier's strict string match
  failed against an equivalent-but-differently-formatted answer. The
  generated problem is fine; the verifier was the issue.
- **`confirmed_flagged`** — the generated problem itself is broken: wrong
  answer key, missing constraint, contradictory premise, ambiguous prompt
  that admits multiple answers it shouldn't, or a math error the
  generator made that the verifier correctly caught.

## Edge case: open-ended problems

An *open-ended problem* asks for "three values of x such that …", "any
two examples that satisfy …", or similar — a constraint the student must
satisfy rather than a unique answer to compute. Generator and verifier
will often pick different valid sets, so the verifier raises a flag even
though both their answers are correct.

**Label these `approved` if and only if all three hold:**

1. The generated problem statement makes clear that *any* set satisfying
   the constraint is acceptable. ("Find three values of x such that
   15/x ≤ 5" — yes. "Solve 15/x ≤ 5" with the answer "x ≥ 3" — no, this
   is not open-ended.)
2. The verifier's independent solution satisfies the constraint stated in
   the problem.
3. The expected answer the generator stored also satisfies the constraint.

If any of the three fail — for example the generator's stored "expected
answer" doesn't satisfy its own constraint — label `confirmed_flagged`
even though the problem class is open-ended. That's a real generator
bug, not a verifier false positive.

## Edge case: partial credit / "close enough"

A problem with one canonical answer but where the student's work shows a
small slip (e.g., correct method, dropped a sign at the end). For the
purposes of this rubric, the verifier compares the *generator's stored
answer* against its *independent solution*, not against student work.
So partial credit doesn't apply here. If the generator's stored answer
matches the verifier's independent solve, `approved`. If they materially
diverge, `confirmed_flagged`.

## Discipline

Re-read the problem text before labeling. The Phase 5g shift (pre-fix
worksheets labeled `confirmed_flagged` and post-fix worksheets labeled
`approved` for the *same problem class*) came from a quiet drift in what
"open-ended" meant. Stick to the three-condition test above so the metric
moves with model behavior, not with labeler mood.

---

This rubric is referenced from `verifier_calibration_eval.py`. Edits
here change the scoring contract; re-run the eval after any change.
