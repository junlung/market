import { SignInForm } from "@/components/auth/sign-in-form";

type Props = {
  searchParams: Promise<{
    registered?: string;
    pending?: string;
    // appended by the auth middleware when it bounces a signed-out request;
    // validated in safeCallbackUrl before use
    callbackUrl?: string;
  }>;
};

// Rendered only in local development (`next dev`) — production builds never
// include this, so deployed instances show no hint that demo accounts exist.
function DemoAccounts() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
      <p className="font-semibold text-foreground">Local dev — seeded accounts</p>
      <p className="mt-1 tabular-nums">
        admin@ · alex@ · blair@ · casey@ · dana@prollymarket.local
      </p>
      <p>
        Password: <span className="font-medium">{process.env.SEED_DEFAULT_PASSWORD ?? "password123"}</span>
      </p>
    </div>
  );
}

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Welcome back. The pools missed you.</p>
      </div>
      {params.registered === "1" ? (
        <p className="rounded-lg bg-yes-bg px-3 py-2 text-sm font-medium text-yes">
          Account created. Sign in with your new credentials.
        </p>
      ) : null}
      {params.pending === "1" ? (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm font-medium text-warn">
          You&apos;re in the queue! An admin has to approve your account before you can log in — nudge
          a friend in the league to vouch for you.
        </p>
      ) : null}
      <SignInForm callbackUrl={params.callbackUrl} />
      <DemoAccounts />
    </div>
  );
}
