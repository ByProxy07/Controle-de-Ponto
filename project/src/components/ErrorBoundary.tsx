import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="p-8">
          <h1 className="text-xl font-bold">
            Não foi possível exibir o sistema.
          </h1>
          <p>
            Recarregue a página. Se o problema continuar, contate o responsável.
            Confirme seus registros antes de repetir uma batida.
          </p>
          <button
            className="mt-4 underline"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </main>
      );
    return this.props.children;
  }
}
