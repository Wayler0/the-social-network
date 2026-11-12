/** Temporary screen body for routes whose real screen is a later issue. */
export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="empty">
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}
