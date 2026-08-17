export function Panel({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-lg border border-brass bg-panel ${className}`}>
      <div className="border-b border-brass-soft px-4 py-2">
        <h2 className="text-[0.68rem] uppercase tracking-[0.14em] text-parchment-dim">{title}</h2>
      </div>
      {children}
    </section>
  );
}
