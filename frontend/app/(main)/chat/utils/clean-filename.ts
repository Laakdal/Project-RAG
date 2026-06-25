/**
 * Strip emoji, pictographs, and mojibake junk from a filename for display.
 *
 * Filenames can arrive with a leading emoji that got mis-encoded at upload time
 * (UTF-8 bytes read as latin1), e.g. a "Report.pdf" prefixed with garbage bytes.
 * This drops emoji/symbols and any leading non-alphanumeric run, leaving the
 * readable name. Falls back to the original if cleaning leaves nothing.
 *
 * Implemented with numeric code-point checks (no \u escapes / `u` flag) so it
 * compiles regardless of the TS target.
 */
export function cleanFilename(name: string): string {
  if (!name) return name;

  let out = '';
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    // High surrogate -> an astral char (emoji / pictograph): skip both units.
    if (code >= 0xd800 && code <= 0xdbff) {
      i++;
      continue;
    }
    // BMP arrows / geometric / dingbats / misc symbols (0x2190-0x2BFF),
    // variation selectors (0xFE00-0xFE0F), zero-width joiner, replacement char.
    if (
      (code >= 0x2190 && code <= 0x2bff) ||
      (code >= 0xfe00 && code <= 0xfe0f) ||
      code === 0x200d ||
      code === 0xfffd
    ) {
      continue;
    }
    out += name.charAt(i);
  }

  // Strip any leading run of non-(ASCII letter/digit/paren) — clears leftover
  // mojibake bytes that sit before the real filename — then tidy whitespace.
  out = out.replace(/^[^A-Za-z0-9(]+/, '').replace(/\s+/g, ' ').trim();
  return out || name;
}
