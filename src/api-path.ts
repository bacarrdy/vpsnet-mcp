/** Reject URL normalization and delimiter tricks before credentials or transport. */
export function validateApiPath(path: string): void {
  if (
    typeof path !== "string" ||
    path.length > 8192 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\#\s\x00-\x1f\x7f]/u.test(path)
  ) {
    throw new Error("Invalid VPSnet API route.");
  }
  const pathname = path.split("?", 1)[0];
  for (const segment of pathname.slice(1).split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Invalid VPSnet API route encoding.");
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      /[/%\\?#\s\x00-\x1f\x7f]/u.test(decoded)
    ) {
      throw new Error("Invalid VPSnet API route segment.");
    }
  }
}
