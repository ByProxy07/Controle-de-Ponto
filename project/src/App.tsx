import { useState } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthPage from "@/pages/AuthPage";
import EmployeePanel from "@/pages/EmployeePanel";
import AdminPanel from "@/pages/AdminPanel";
import { Spinner } from "@/components/ui";
import { Fingerprint, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";

type ViewMode = "admin" | "employee";

function AppContent() {
  const {
    session,
    profile,
    loading,
    error,
    recovery,
    signOut,
    refreshProfile,
  } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("admin");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (recovery || !session) {
    return <AuthPage />;
  }

  if (error || !profile || !profile.active)
    return (
      <main className="min-h-screen grid place-items-center bg-slate-100 p-6">
        <section className="panel max-w-lg">
          <h1 className="text-xl font-bold mb-3">
            {error
              ? "Não foi possível carregar sua conta"
              : "Aguardando ativação"}
          </h1>
          <p role="alert">
            {error ||
              "O administrador precisa ativar seu cadastro antes do primeiro registro de ponto."}
          </p>
          <div className="flex gap-4 mt-5">
            <button onClick={refreshProfile}>Verificar novamente</button>
            <button onClick={signOut}>Sair</button>
          </div>
        </section>
      </main>
    );

  const isAdmin = profile.role === "admin";

  // Admin can switch between coordinator and employee views
  if (isAdmin) {
    return (
      <div>
        {/* View mode switcher bar */}
        <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 h-12 flex items-center justify-center px-4">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => setViewMode("admin")}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                viewMode === "admin"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              Coordenador
            </button>
            <button
              onClick={() => setViewMode("employee")}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                viewMode === "employee"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              <Fingerprint className="w-4 h-4" />
              Meu ponto
            </button>
          </div>
        </div>

        {/* Content with top padding for the switcher bar */}
        <div className="pt-12">
          {viewMode === "admin" ? <AdminPanel /> : <EmployeePanel />}
        </div>
      </div>
    );
  }

  return <EmployeePanel />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
