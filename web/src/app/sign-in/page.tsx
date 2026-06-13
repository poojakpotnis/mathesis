import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;
  const session = await auth();
  if (session?.user) {
    redirect(callbackUrl ?? "/");
  }

  const errorMessage = error ? readableError(error) : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 -ml-64">
      <div className="w-full max-w-sm border border-border rounded-lg bg-card px-8 py-10 text-center">
        <h1
          className="text-3xl tracking-tight text-primary"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Mathesis
        </h1>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mt-2 font-light">
          Practice · Track · Master
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", {
              redirectTo: callbackUrl ?? "/",
            });
          }}
          className="mt-10"
        >
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background hover:bg-accent transition-colors px-4 py-2.5 text-sm font-medium text-foreground"
          >
            <GoogleIcon className="w-4 h-4" />
            Sign in with Google
          </button>
        </form>

        {errorMessage && (
          <p className="mt-6 text-xs text-destructive">{errorMessage}</p>
        )}
        <p className="mt-6 text-[11px] text-muted-foreground font-light">
          Access is restricted to a private allowlist.
        </p>
        <p className="mt-4 text-[11px] font-light">
          <Link
            href="/about"
            className="text-primary hover:underline underline-offset-4"
          >
            What is this?
          </Link>
        </p>
      </div>
    </div>
  );
}

function readableError(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "That Google account isn't on the allowlist for this app.";
    case "Configuration":
      return "Auth is misconfigured (missing env vars?). Check the server logs.";
    default:
      return `Sign-in failed (${code}).`;
  }
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M21.35 11.1H12v3.8h5.35c-.23 1.46-1.7 4.27-5.35 4.27-3.22 0-5.85-2.67-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.95 4.78 14.7 3.8 12 3.8 6.93 3.8 2.85 7.88 2.85 13s4.08 9.2 9.15 9.2c5.28 0 8.78-3.7 8.78-8.92 0-.6-.07-1.07-.43-2.18z"
        fill="currentColor"
      />
    </svg>
  );
}
