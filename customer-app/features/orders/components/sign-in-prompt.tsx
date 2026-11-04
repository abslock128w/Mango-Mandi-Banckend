import { SignInPrompt as AccountSignInPrompt } from "@/features/account/components/bits";

/** The orders pages' sign-in prompt: the same card (heading, icon, button) as the account pages. */
export function SignInPrompt({ next, title = "Sign in to see your orders", body = "Track each order, report a problem and order again." }: { next: string; title?: string; body?: string }) {
  return <AccountSignInPrompt next={next} title={title} body={body} />;
}
