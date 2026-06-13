import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Hard allowlist. Google's "Test users" list is the first gate (only these
// emails can complete OAuth at Google); this is the second, stricter gate
// (we reject anyone else even if they somehow get past Google). Either gate
// alone would be enough; both means a Google config slip-up doesn't hand
// access to anyone.
const ALLOWED_EMAILS = new Set([
  "poojakpotnis@gmail.com",
  "rohit.potnis@gmail.com",
  "kavyapotnis13@gmail.com",
]);

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Force Google's account picker on every sign-in so a shared
      // machine can switch between Pooja / Rohit / Kavya cleanly
      // instead of silently reusing whichever Google account happens
      // to be active in the browser.
      authorization: {
        params: { prompt: "select_account" },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      return ALLOWED_EMAILS.has(user.email.toLowerCase());
    },
  },
  pages: {
    signIn: "/sign-in",
  },
});
