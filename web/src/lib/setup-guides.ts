// Setup snippets for the official Sentry SDKs. Sentric speaks the Sentry
// protocol, so these are the real libraries and the real init calls — only the
// DSN points somewhere else.
export interface SetupGuide {
  id: string;
  name: string;
  install: string;
  code: string;
  language: string;
  note?: string;
}

export function setupGuides(dsn: string): SetupGuide[] {
  return [
    {
      id: "javascript",
      name: "Browser",
      language: "javascript",
      install: "npm install @sentry/browser",
      code: `import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "${dsn}",
  // Sentric ignores performance data, so leave tracing off.
  tracesSampleRate: 0,
});

// Verify your setup:
Sentry.captureException(new Error("Hello from Sentric"));`,
    },
    {
      id: "node",
      name: "Node.js",
      language: "javascript",
      install: "npm install @sentry/node",
      code: `// Import this file before anything else in your app.
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "${dsn}",
  release: "my-app@1.0.0",
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
});

Sentry.captureException(new Error("Hello from Sentric"));`,
    },
    {
      id: "nextjs",
      name: "Next.js",
      language: "javascript",
      install: "npm install @sentry/nextjs",
      note: "Put this in instrumentation.ts (server) and instrumentation-client.ts (browser). Skip the Sentry wizard — it targets sentry.io.",
      code: `import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "${dsn}",
  tracesSampleRate: 0,
});`,
    },
    {
      id: "python",
      name: "Python",
      language: "python",
      install: "pip install sentry-sdk",
      code: `import sentry_sdk

sentry_sdk.init(
    dsn="${dsn}",
    release="my-app@1.0.0",
    environment="production",
    traces_sample_rate=0,
)

raise ValueError("Hello from Sentric")`,
    },
    {
      id: "django",
      name: "Django",
      language: "python",
      install: "pip install sentry-sdk",
      note: "Add to settings.py.",
      code: `import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration

sentry_sdk.init(
    dsn="${dsn}",
    integrations=[DjangoIntegration()],
    traces_sample_rate=0,
)`,
    },
    {
      id: "curl",
      name: "curl",
      language: "bash",
      note: "No SDK needed — useful for testing the endpoint directly.",
      install: "",
      code: `curl -X POST "${dsnToStoreUrl(dsn)}" \\
  -H 'Content-Type: application/json' \\
  -d '{"message":"Hello from curl","level":"error"}'`,
    },
  ];
}

// http://<key>@host/<id>  ->  http://host/api/<id>/store/?sentry_key=<key>
function dsnToStoreUrl(dsn: string): string {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/\//g, "");
    return `${url.protocol}//${url.host}/api/${projectId}/store/?sentry_key=${url.username}`;
  } catch {
    return dsn;
  }
}
