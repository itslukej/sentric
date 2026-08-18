// Byte-accurate Sentry envelope parser.
//
//   Envelope = JSON header "\n" { Item }
//   Item     = JSON item-header "\n" payload ( "\n" | EOF )
//
// Item headers may declare `length` (payload byte count); without it the
// payload runs to the next newline. Parsing must operate on bytes, not
// strings: `length` counts bytes and payloads can contain multibyte UTF-8.

export interface EnvelopeItem {
  type: string;
  payload: Buffer;
}

export interface ParsedEnvelope {
  header: Record<string, unknown>;
  items: EnvelopeItem[];
}

function readLine(buf: Buffer, offset: number): { line: Buffer; next: number } {
  const nl = buf.indexOf(0x0a, offset);
  if (nl === -1) return { line: buf.subarray(offset), next: buf.length };
  return { line: buf.subarray(offset, nl), next: nl + 1 };
}

export function parseEnvelope(buf: Buffer): ParsedEnvelope {
  let offset = 0;
  const headerLine = readLine(buf, offset);
  offset = headerLine.next;
  const header = JSON.parse(headerLine.line.toString("utf8") || "{}") as Record<
    string,
    unknown
  >;

  const items: EnvelopeItem[] = [];
  while (offset < buf.length) {
    const itemHeaderLine = readLine(buf, offset);
    const raw = itemHeaderLine.line.toString("utf8").trim();
    offset = itemHeaderLine.next;
    if (raw === "") continue; // tolerate trailing/blank lines

    const itemHeader = JSON.parse(raw) as { type?: string; length?: number };
    let payload: Buffer;
    if (itemHeader.length !== undefined) {
      // Validate the client-supplied length so the cursor can only move
      // forward and stay in bounds. Without this, a negative length rewinds
      // `offset` and the while-loop never terminates (unauthenticated DoS);
      // an oversized length would silently swallow the rest of the envelope.
      const len = itemHeader.length;
      if (!Number.isInteger(len) || len < 0 || offset + len > buf.length) {
        throw new Error("invalid envelope item length");
      }
      payload = buf.subarray(offset, offset + len);
      offset += len;
      // consume the single newline terminating a length-prefixed payload
      if (buf[offset] === 0x0a) offset += 1;
    } else {
      const payloadLine = readLine(buf, offset);
      payload = payloadLine.line;
      offset = payloadLine.next;
    }
    items.push({ type: itemHeader.type ?? "unknown", payload });
  }

  return { header, items };
}
