import Link from "next/link";
import { setupGuides } from "./setup-guides";

// Platform tabs without client JS: the selected platform is a query param.
export function SetupInstructions({
  dsn,
  platform,
  hrefFor,
}: {
  dsn: string;
  platform?: string;
  hrefFor: (platform: string) => string;
}) {
  const guides = setupGuides(dsn);
  const active = guides.find((g) => g.id === platform) ?? guides[0];

  return (
    <div className="setup">
      <div className="btn-bar setup-tabs">
        {guides.map((g) => (
          <Link
            key={g.id}
            href={hrefFor(g.id)}
            className={g.id === active.id ? "active" : ""}
          >
            {g.name}
          </Link>
        ))}
      </div>

      {active.install && (
        <>
          <p className="setup-step">1. Install the SDK</p>
          <pre className="code-block">{active.install}</pre>
          <p className="setup-step">2. Initialize it with your DSN</p>
        </>
      )}
      {active.note && <p className="muted setup-note">{active.note}</p>}
      <pre className="code-block">{active.code}</pre>
    </div>
  );
}
