import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, errorMessage } from "@/lib/supabaseClient";
import type { Profile } from "@/lib/types";
interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  recovery: boolean;
  finishRecovery: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}
const Context = createContext<AuthValue | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(
    window.location.hash.includes("type=recovery"),
  );
  const [revision, setRevision] = useState(0);
  const userId = session?.user.id;
  useEffect(() => {
    let live = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (live) {
          setSession(data.session);
          if (error) setError(error.message);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(next);
      if (!next) { setProfile(null); setLoading(false); }
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    let live = true;
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (live) {
            setProfile(data as Profile | null);
            setError(
              error
                ? error.message
                : !data
                  ? "Perfil não encontrado. Solicite ao responsável conferir as migrações."
                  : null,
            );
            setLoading(false);
          }
        },
        (e) => {
          if (live) {
            setError(errorMessage(e));
            setLoading(false);
          }
        },
      );
    return () => {
      live = false;
    };
  }, [userId, revision]);
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setError(error.message);
      return;
    }
    setSession(null);
    setProfile(null);
    setRecovery(false);
  };
  return (
    <Context.Provider
      value={{
        session,
        profile,
        loading,
        error,
        recovery,
        finishRecovery: () => setRecovery(false),
        signOut,
        refreshProfile: async () => setRevision((v) => v + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider ausente");
  return value;
}
