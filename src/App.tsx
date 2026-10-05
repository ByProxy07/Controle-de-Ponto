import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthPage from "@/pages/AuthPage";
import EmployeePanel from "@/pages/EmployeePanel";
import AdminPanel from "@/pages/AdminPanel";
import { MotoristaPonto } from "@/pages/MotoristaPonto";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui";
function driverRoute() {
  return (
    /^\/motoristas?\/?$/.test(window.location.pathname) ||
    /^#\/?motoristas?\/?$/.test(window.location.hash)
  );
}
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
  const [driver, setDriver] = useState(driverRoute);
  const [view, setView] = useState<"admin" | "employee">("admin");
  useEffect(() => {
    const change = () => setDriver(driverRoute());
    window.addEventListener("popstate", change);
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("popstate", change);
      window.removeEventListener("hashchange", change);
    };
  }, []);
  if (driver || profile?.account_kind === "driver") return <MotoristaPonto />;
  if (loading)
    return (
      <main className="p-8" role="status">
        Carregando sua conta…
      </main>
    );
  if (recovery || !session) return <AuthPage />;
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
            <Button onClick={refreshProfile}>Verificar novamente</Button>
            <Button variant="outline" onClick={signOut}>
              Sair
            </Button>
          </div>
        </section>
      </main>
    );
  if (profile.role === "admin")
    return (
      <>
        <nav className="no-print sticky top-0 z-40 bg-white border-b p-2 flex justify-center gap-2">
          <Button
            variant={view === "admin" ? "primary" : "secondary"}
            onClick={() => setView("admin")}
          >
            Coordenador
          </Button>
          <Button
            variant={view === "employee" ? "primary" : "secondary"}
            onClick={() => setView("employee")}
          >
            Meu ponto
          </Button>
        </nav>
        {view === "admin" ? <AdminPanel /> : <EmployeePanel />}
      </>
    );
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
