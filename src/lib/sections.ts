// Splitting a page's Markdown into its "##" sections, so each can be searched and quoted on its own.

const MAX_SECTION = 1600; // characters per searchable section

export type Section = { heading: string; content: string };

/** Splits Markdown at its "##" headings, breaking long sections at paragraph boundaries. */
export function splitSections(body: string): Section[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  let fence = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence ? line.match(/^##\s+(.+?)\s*#*\s*$/) : null;
    if (h) sections.push({ heading: h[1], lines: [] });
    else sections.at(-1)!.lines.push(line);
  }
  const out: Section[] = [];
  for (const s of sections) {
    const text = s.lines.join("\n").trim();
    if (!text) {
      if (s.heading) out.push({ heading: s.heading, content: "" });
      continue;
    }
    let current = "";
    for (const para of text.split(/\n{2,}/)) {
      if (current && current.length + para.length > MAX_SECTION) {
        out.push({ heading: s.heading, content: current });
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    out.push({ heading: s.heading, content: current });
  }
  return out;
}
