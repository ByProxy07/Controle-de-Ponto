import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-2xl border border-slate-200 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info" | "neutral";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  className,
}: BadgeProps) {
  const variants = {
    default: "bg-slate-100 text-slate-700",
    success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    error: "bg-red-50 text-red-700 ring-1 ring-red-200",
    info: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    neutral: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm",
    secondary: "bg-slate-100 hover:bg-slate-200 text-slate-700",
    ghost: "hover:bg-slate-100 text-slate-600",
    danger: "bg-red-600 hover:bg-red-500 text-white shadow-sm",
    outline:
      "border border-slate-300 hover:border-slate-400 text-slate-700 hover:bg-slate-50",
  };

  const sizes = {
    sm: "text-sm px-3 py-1.5",
    md: "text-sm px-4 py-2.5",
    lg: "text-base px-6 py-3",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent?: "emerald" | "blue" | "amber" | "red" | "slate";
}

export function StatCard({
  label,
  value,
  icon,
  accent = "slate",
}: StatCardProps) {
  const accents = {
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    blue: "bg-blue-50 text-blue-600 ring-blue-200",
    amber: "bg-amber-50 text-amber-600 ring-amber-200",
    red: "bg-red-50 text-red-600 ring-red-200",
    slate: "bg-slate-50 text-slate-600 ring-slate-200",
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
        </div>
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center ring-1",
            accents[accent],
          )}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
        {icon}
      </div>
      <p className="text-slate-600 font-medium">{title}</p>
      {description && (
        <p className="text-slate-400 text-sm mt-1">{description}</p>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-5 h-5 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin",
        className,
      )}
    />
  );
}
