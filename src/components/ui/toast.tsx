"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import clsx from "clsx";

type Toast = {
  id: number;
  kind: "success" | "error";
  message: string;
};

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, kind, message }]);
  }, []);

  const success = useCallback((message: string) => push("success", message), [push]);
  const error = useCallback((message: string) => push("error", message), [push]);

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDone={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const hide = setTimeout(() => setLeaving(true), 3200);
    const remove = setTimeout(onDone, 3600);
    return () => {
      clearTimeout(hide);
      clearTimeout(remove);
    };
  }, [onDone]);

  return (
    <div
      role="status"
      className={clsx(
        "pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium shadow-lg transition-all duration-300",
        leaving ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      {toast.kind === "success" ? (
        <CheckCircle2 className="size-4 shrink-0 text-yes" aria-hidden />
      ) : (
        <XCircle className="size-4 shrink-0 text-no" aria-hidden />
      )}
      <span>{toast.message}</span>
    </div>
  );
}
