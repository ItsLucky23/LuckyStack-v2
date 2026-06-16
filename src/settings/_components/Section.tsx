interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <section className="bg-container1 border border-container1-border rounded-xl p-5 flex flex-col gap-3">
      <h2 className="text-base font-semibold text-title">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
