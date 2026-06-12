import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  concepts,
  problemConcepts,
  scrapedProblems,
} from "@/lib/db/schema";

// ≥50% image-backed source problems → visual_dominant. 1-49% → mixed.
// 0 → text_dominant (also the schema default for concepts that have never
// been mapped to any source problem).
//
// The phase 6.5 plan suggested ≥80%, but RSM's scraped data underflags
// has_image — diagrams that the original page renders as scaled SVGs land
// in problem_text as "Find the area of the parallelogram." with no
// has_image. After inspection (`backfill … --dry`), every actually-visual
// geometry concept lands at ≤75%; 80% catches nothing. 50% catches the
// area_trapezoid incident concept plus path_tracing / net_3d_shapes /
// area_composite_figures / logic_reasoning.
//
// area_parallelogram (0/3 image) and angle_relationships (22% image) are
// known to be visually-taught but won't be caught by any ratio threshold
// against this data. The --dry output flags them so a parent can decide
// whether to manually upgrade them to visual_dominant.
const VISUAL_THRESHOLD = 0.5;

// Manual upgrade list for geometry concepts that are visual in the
// curriculum but won't cross the ratio threshold because of has_image
// underflagging on diagram-referencing problems. Concept *names* (not ids)
// so this survives a re-ingest. Reviewed and ratified 2026-06-11.
const VISUAL_OVERRIDES = new Set([
  "area_parallelogram",
  "angle_relationships",
  "midpoint_formula",
  "coordinate_geometry",
  "isosceles_triangle_properties",
  "rectangle_properties",
  "polygon_decomposition",
]);

type Mode = "text_dominant" | "mixed" | "visual_dominant";

function classify(name: string, total: number, withImage: number): Mode {
  if (VISUAL_OVERRIDES.has(name)) return "visual_dominant";
  if (total === 0 || withImage === 0) return "text_dominant";
  const ratio = withImage / total;
  if (ratio >= VISUAL_THRESHOLD) return "visual_dominant";
  return "mixed";
}

async function main() {
  const dryRun = process.argv.includes("--dry");

  const counts = await db()
    .select({
      conceptId: concepts.id,
      total: sql<number>`count(${problemConcepts.id})`,
      withImage: sql<number>`sum(case when ${scrapedProblems.hasImage} = 1 then 1 else 0 end)`,
    })
    .from(concepts)
    .leftJoin(problemConcepts, eq(problemConcepts.conceptId, concepts.id))
    .leftJoin(
      scrapedProblems,
      eq(problemConcepts.scrapedProblemId, scrapedProblems.id)
    )
    .groupBy(concepts.id);

  const allConcepts = await db()
    .select({
      id: concepts.id,
      name: concepts.name,
      category: concepts.category,
      modalityTag: concepts.modalityTag,
    })
    .from(concepts);
  const byId = new Map(allConcepts.map((c) => [c.id, c]));

  const planned: { id: number; from: Mode; to: Mode; total: number; withImage: number; name: string }[] = [];
  for (const row of counts) {
    const c = byId.get(row.conceptId);
    if (!c) continue;
    const total = Number(row.total ?? 0);
    const withImage = Number(row.withImage ?? 0);
    const target = classify(c.name, total, withImage);
    if (target !== c.modalityTag) {
      planned.push({
        id: c.id,
        from: c.modalityTag as Mode,
        to: target,
        total,
        withImage,
        name: c.name,
      });
    }
  }

  planned.sort((a, b) => a.to.localeCompare(b.to) || a.name.localeCompare(b.name));

  console.log(`Concepts: ${allConcepts.length}. Updates planned: ${planned.length}.`);
  for (const p of planned) {
    const pct = p.total > 0 ? Math.round((p.withImage / p.total) * 100) : 0;
    console.log(
      `  ${String(p.id).padStart(3)}  ${p.from.padEnd(15)} → ${p.to.padEnd(15)}  (${p.withImage}/${p.total} image, ${pct}%)  ${p.name}`
    );
  }

  // Watchlist: geometry-category concepts that stayed text_dominant or mixed
  // despite living in a visual subject. has_image underflagging on RSM means
  // some genuinely visual concepts (e.g. area_parallelogram, "Find x" angle
  // problems) don't cross the ratio threshold. Worth a manual eyeball.
  const geomWatch = counts
    .map((row) => {
      const c = byId.get(row.conceptId);
      if (!c) return null;
      if (c.category !== "geometry") return null;
      const total = Number(row.total ?? 0);
      const withImage = Number(row.withImage ?? 0);
      const target = classify(c.name, total, withImage);
      if (target === "visual_dominant") return null;
      return { id: c.id, name: c.name, target, total, withImage };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.total > 0);

  if (geomWatch.length > 0) {
    console.log(`\nGeometry watchlist (not visual_dominant — review manually):`);
    for (const g of geomWatch) {
      const pct = g.total > 0 ? Math.round((g.withImage / g.total) * 100) : 0;
      console.log(
        `  ${String(g.id).padStart(3)}  ${g.target.padEnd(15)}  (${g.withImage}/${g.total} image, ${pct}%)  ${g.name}`
      );
    }
  }

  if (dryRun) {
    console.log("\n--dry: no writes performed.");
    return;
  }

  for (const p of planned) {
    await db()
      .update(concepts)
      .set({ modalityTag: p.to })
      .where(eq(concepts.id, p.id));
  }
  console.log(`\nApplied ${planned.length} update(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
