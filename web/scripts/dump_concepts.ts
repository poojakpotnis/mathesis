import { db } from "@/lib/db/client";
import { concepts } from "@/lib/db/schema";

async function main() {
  const rows = await db()
    .select({ id: concepts.id, name: concepts.name, displayName: concepts.displayName, category: concepts.category, createdBy: concepts.createdBy })
    .from(concepts)
    .orderBy(concepts.category, concepts.name);

  console.log(`Total concepts: ${rows.length}`);
  console.log("");
  for (const r of rows) {
    console.log(`  ${String(r.id).padStart(3)}  ${r.category.padEnd(20)} ${r.name.padEnd(40)} "${r.displayName}"`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
