import { z } from "zod";
import { defineSurface } from "./define";
import { get } from "./directions";

// ponytail: the summary endpoint takes a title, not a query (it follows redirects); the model knows most titles.
// Add Wikipedia's search first if near-misses turn out common.
export type WikiData = { title: string; description: string; extract: string; image: string | null; url: string; ambiguous: boolean };

export const wiki = defineSurface({
  name: "wiki",
  title: "Wikipedia",
  when: "who or what someone or something is (people, places, things, events); title as on Wikipedia; lang is the user's language",
  params: z.object({ title: z.string().min(1).max(200), lang: z.string().regex(/^[a-z]{2,3}$/).default("en") }),
  async fetch({ title, lang }): Promise<WikiData> {
    const r = (await get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`).catch(() => {
      throw new Error(`No ${lang} Wikipedia article called "${title}"`);
    })) as { title: string; description?: string; extract: string; type: string; thumbnail?: { source: string }; content_urls: { desktop: { page: string } } };
    return {
      title: r.title,
      description: r.description ?? "",
      extract: r.extract.slice(0, 1500),
      image: r.thumbnail?.source ?? null,
      url: r.content_urls.desktop.page,
      ambiguous: r.type === "disambiguation",
    };
  },
  summary: (_, d) => `${d.title}${d.description ? `: ${d.description}` : ""}. ${d.extract.split(". ")[0]}.`,
});
