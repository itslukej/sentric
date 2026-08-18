import type { ObjectId } from "mongodb";

export interface UserDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  /** disabled accounts are refused at login (existing sessions expire naturally) */
  disabled?: boolean;
  createdAt: Date;
}

export interface ProjectDoc {
  _id?: ObjectId;
  projectId: number;
  name: string;
  publicKey: string;
  members: string[]; // usernames with dashboard access (ingest auth uses publicKey)
  createdAt: Date;
}

// _id is required here (web only ever reads persisted docs); the ingest copy
// makes it optional because ingest constructs docs before insert.
export interface IssueDoc {
  _id: ObjectId;
  projectId: number;
  fingerprint: string;
  title: string;
  culprit: string;
  level: string;
  status: "open" | "resolved";
  /** true when a resolved issue came back; cleared when resolved again */
  regressed?: boolean;
  resolvedAt?: Date;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  /** capped facets for dashboard filtering, unioned per event */
  releases?: string[];
  environments?: string[];
  tags?: string[]; // "key:value"
}

export interface SentryStackFrame {
  filename?: string;
  module?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
}

export interface SentryExceptionValue {
  type?: string;
  value?: string;
  module?: string;
  stacktrace?: { frames?: SentryStackFrame[] };
}

export interface SentryBreadcrumb {
  timestamp?: string | number;
  type?: string;
  category?: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface SentryRequest {
  url?: string;
  method?: string;
  query_string?: string | Record<string, string>;
  headers?: Record<string, string>;
  data?: unknown;
}

export interface SentryUser {
  id?: string;
  username?: string;
  email?: string;
  ip_address?: string;
  [key: string]: unknown;
}

export interface EventDoc {
  _id: ObjectId;
  issueId: ObjectId;
  projectId: number;
  eventId: string;
  timestamp: Date;
  level: string;
  payload: {
    exception?: { values?: SentryExceptionValue[] } | SentryExceptionValue[];
    message?: string | { formatted?: string; message?: string };
    tags?: Record<string, string>;
    release?: string;
    environment?: string;
    server_name?: string;
    platform?: string;
    sdk?: { name?: string; version?: string };
    breadcrumbs?: { values?: SentryBreadcrumb[] } | SentryBreadcrumb[];
    request?: SentryRequest;
    user?: SentryUser;
    contexts?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  receivedAt: Date;
}
