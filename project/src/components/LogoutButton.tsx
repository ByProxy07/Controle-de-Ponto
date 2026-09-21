import { LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export function LogoutButton() {
  const { signOut, profile } = useAuth();

  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:block text-right">
        <p className="text-sm font-medium text-slate-700">{profile?.name}</p>
        <p className="text-xs text-slate-400">{profile?.email}</p>
      </div>
      <button
        onClick={signOut}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all"
      >
        <LogOut className="w-4 h-4" />
        <span className="hidden sm:inline">Sair</span>
      </button>
    </div>
  );
}
