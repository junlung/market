export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-2xl font-bold tracking-tight">
          Prolly<span className="text-primary">Market</span>
        </p>
        <p className="mt-1 text-sm text-muted">Real odds. Fake money. Eternal glory.</p>
      </div>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-8">
        {children}
      </div>
      <p className="mt-6 max-w-sm text-center text-xs text-faint">
        Points only. No money in, no money out — just a friend group settling arguments the honest way.
      </p>
    </main>
  );
}
