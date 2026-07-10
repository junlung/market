import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Create account</h1>
        <p className="mt-1 text-sm text-muted">
          Anyone can sign up, but an admin has to approve your account before you can log in. Knowing
          someone in the league helps.
        </p>
      </div>
      <SignUpForm />
    </div>
  );
}
