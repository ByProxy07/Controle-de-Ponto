import { useState } from "react";
import { driverApi } from "@/lib/driverApi";
import { errorMessage } from "@/lib/supabaseClient";
import type { Profile } from "@/lib/types";
import { Button } from "./ui";
export function DriverPinReset({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin !== confirm) {
      setError("Os PINs devem ser iguais.");
      return;
    }
    setBusy(true);
    try {
      const result = await driverApi({
        action: "reset-pin",
        userId: profile.id,
        pin,
        reason,
      });
      setNotice(result.message ?? "PIN redefinido.");
      setPin("");
      setConfirm("");
      setReason("");
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          setNotice("");
        }}
      >
        Redefinir PIN
      </Button>
      {notice && (
        <p className="text-sm text-emerald-800" role="status">
          {notice}
        </p>
      )}
      {open && (
        <div
          className="fixed inset-0 bg-slate-950/60 z-[70] grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Redefinir PIN do motorista"
        >
          <form className="panel max-w-md w-full space-y-4" onSubmit={save}>
            <h2 className="font-bold text-xl">Novo PIN para {profile.name}</h2>
            <p>
              Confira a identidade pessoalmente antes de continuar. CPF final{" "}
              {profile.cpf_last4}. O motorista não recebe e-mail.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <label className="field">
              Novo PIN (6 números)
              <input
                required
                autoComplete="new-password"
                type="password"
                inputMode="numeric"
                minLength={6}
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="field">
              Confirmar novo PIN
              <input
                required
                autoComplete="new-password"
                type="password"
                inputMode="numeric"
                minLength={6}
                maxLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="field">
              Motivo da redefinição
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="flex gap-3">
              <Button disabled={busy}>Salvar novo PIN</Button>
              <Button
                type="button"
                disabled={busy}
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setPin("");
                  setConfirm("");
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
