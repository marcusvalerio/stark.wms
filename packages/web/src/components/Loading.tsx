export function Loading({ label = "Carregando..." }: { label?: string }) {
  return <div className="empty-state">{label}</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="banner danger">⚠ {message}</div>;
}
