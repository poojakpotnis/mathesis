import type { Metadata } from "next";
import { DM_Serif_Display, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { auth, signOut } from "@/auth";

const serif = DM_Serif_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: "400",
});

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Mathesis",
  description: "Practice worksheet generator & progress tracker",
};

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/sign-in" });
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const user = session?.user
    ? { name: session.user.name ?? null, email: session.user.email ?? null }
    : null;

  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} h-full`}>
      <body className="min-h-full flex bg-background text-foreground antialiased">
        <Sidebar user={user} signOutAction={signOutAction} />
        <main className="flex-1 ml-64 min-h-screen print:ml-0">
          <div className="max-w-6xl mx-auto px-8 py-10 print:max-w-none print:px-0 print:pt-4 print:pb-0">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
