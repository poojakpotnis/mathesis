import Link from "next/link";

// Drop PNG/JPG screenshots into /public/screenshots/ with these filenames.
// Aspect ratio doesn't have to match exactly; the container clips at 16:10.
const FEATURES = [
  {
    title: "Unlimited practice on their actual lesson",
    blurb:
      "Tell us the lesson they're on. We generate fresh, never-repeated problems matching that exact content. Print them or solve on screen — same problems either way.",
    image: "/screenshots/worksheet.png",
  },
  {
    title: "Drill the concepts holding them back",
    blurb:
      "One click on any concept generates a worksheet focused only on that. Stop spending homework time on what they already know.",
    image: "/screenshots/drill.png",
  },
  {
    title: "Grade in seconds, not minutes",
    blurb:
      "Mark each answer right or wrong as you go. Add a note about what to revisit. Saves automatically — no spreadsheet to maintain.",
    image: "/screenshots/score.png",
  },
  {
    title: "Know exactly what to work on next",
    blurb:
      "Every answer feeds into concept-level mastery. The dashboard tells you what they've nailed and what still needs work, so practice always has a point.",
    image: "/screenshots/mastery.png",
  },
];

export const metadata = {
  title: "Mathesis",
  description: "Math practice that follows your kid's curriculum.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background -ml-64">
      <main className="max-w-3xl mx-auto px-6 py-20">
        <header className="text-center mb-20">
          <h1
            className="text-6xl tracking-tight text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Mathesis
          </h1>
          <p className="mt-4 text-lg text-foreground/70 font-light max-w-xl mx-auto">
            Fresh math practice on exactly what your kid needs. Built around
            their actual lessons.
          </p>
        </header>

        <Hero src="/screenshots/hero.png" alt="Mathesis worksheet" />

        <div className="mt-24 space-y-24">
          {FEATURES.map((f) => (
            <Feature
              key={f.title}
              title={f.title}
              blurb={f.blurb}
              image={f.image}
            />
          ))}
        </div>

        <div className="mt-24 flex items-center justify-center">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-8 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>

        <footer className="mt-20 text-center text-[11px] text-muted-foreground font-light space-y-1">
          <p>
            Built by Pooja Potnis.
          </p>
        </footer>
      </main>
    </div>
  );
}

function Hero({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative w-full aspect-[16/10] rounded-lg overflow-hidden border border-border bg-muted/30 shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover object-top"
      />
    </div>
  );
}

function Feature({
  title,
  blurb,
  image,
}: {
  title: string;
  blurb: string;
  image: string;
}) {
  return (
    <section>
      <div className="text-center mb-6">
        <h2
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-foreground/60 font-light">
          {blurb}
        </p>
      </div>
      <div className="relative w-full aspect-[16/10] rounded-lg overflow-hidden border border-border bg-muted/30 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover object-top"
        />
      </div>
    </section>
  );
}
