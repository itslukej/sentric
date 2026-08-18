import type { ObjectId } from "mongodb";

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

export interface SentryEvent {
  event_id?: string;
  timestamp?: string | number;
  platform?: string;
  level?: string;
  logger?: string;
  release?: string;
  environment?: string;
  server_name?: string;
  message?: string | { formatted?: string; message?: string };
  logentry?: { formatted?: string; message?: string };
  exception?: { values?: SentryExceptionValue[] } | SentryExceptionValue[];
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  breadcrumbs?: { values?: unknown[] } | unknown[];
  sdk?: { name?: string; version?: string };
  [key: string]: unknown;
}

export interface ProjectDoc {
  _id?: ObjectId;
  projectId: number;
  name: string;
  publicKey: string;
  members: string[]; // usernames with dashboard access (ingest auth uses publicKey)
  createdAt: Date;
}

export interface IssueDoc {
  _id?: ObjectId;
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

export interface EventDoc {
  _id?: ObjectId;
  issueId: ObjectId;
  projectId: number;
  eventId: string;
  timestamp: Date;
  level: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
}

export interface UserDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  /** disabled accounts are refused at login (existing sessions expire naturally) */
  disabled?: boolean;
  createdAt: Date;
}
