// Flatten a LangChain message `content` (string | content-block[]) to plain text.
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === "string"
          ? b
          : b && typeof b === "object" && "text" in b
            ? String((b as { text: unknown }).text)
            : "",
      )
      .join("");
  }
  return "";
}
