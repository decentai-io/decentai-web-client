/**
 * An answer as a voice would say it.
 *
 * Answers are Markdown, and Markdown read out letter by letter is
 * noise: a table becomes a run of bars and dashes, a link its address,
 * a heading a word with no pause after it. This turns the marks into
 * what they mean before anything is spoken — the same here and on the
 * phone (decentai-mobile-client, src/lib/speakable.ts).
 *
 * - A table is read row by row, each value with its column's name:
 *   "Row 1: Name, Ada; Role, Engineer." Past TABLE_ROWS rows it says
 *   how many more there are rather than reading them all.
 * - A link is its words; an image its description, or nothing; a bare
 *   address is "a link".
 * - A heading and a list item end as sentences, so the voice pauses.
 * - Code is left out, as nobody says it; inline code keeps its words.
 */

const TABLE_ROWS = 12;

export function speakable(markdown: string): string {
  const text = String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?(```|$)/g, '\n');
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && isDivider(lines[i + 1])) {
      const header = cells(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push(table(header, rows));
      continue;
    }
    out.push(line(lines[i]));
  }
  return out.filter(Boolean).join('\n');
}

function isRow(line: string | undefined): boolean {
  return !!line && /^\s*\|?.*\|.*\|?\s*$/.test(line) && line.includes('|');
}

function isDivider(line: string | undefined): boolean {
  return !!line && line.includes('|')
    && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split('|').map((cell) => inline(cell).trim());
}

function table(header: string[], rows: string[][]): string {
  const named = header.filter(Boolean);
  const said: string[] = [];
  said.push(`A table of ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
    + (named.length ? `, with the columns ${list(named)}.` : '.'));
  rows.slice(0, TABLE_ROWS).forEach((row, index) => {
    const pairs = row
      .map((value, column) => [header[column] || '', value] as const)
      .filter(([, value]) => value)
      .map(([name, value]) => (name ? `${name}, ${value}` : value));
    if (pairs.length) said.push(`Row ${index + 1}: ${pairs.join('; ')}.`);
  });
  const more = rows.length - TABLE_ROWS;
  if (more > 0) said.push(`And ${more} more ${more === 1 ? 'row' : 'rows'}.`);
  return said.join('\n');
}

function list(names: string[]): string {
  return names.length < 2 ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function line(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /^([-*_]\s*){3,}$/.test(trimmed)) return '';
  const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
  if (heading) return sentence(inline(heading[1]));
  const item = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
  if (item) return sentence(inline(item[1]));
  return inline(trimmed.replace(/^>\s?/, ''));
}

/** A line that ends without a stop gets one, so the voice pauses. */
function sentence(text: string): string {
  const words = text.trim();
  return !words || /[.!?:;؟۔]$/.test(words) ? words : `${words}.`;
}

function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, 'a link')
    .replace(/\bhttps?:\/\/\S+/g, 'a link')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/[*#>|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
