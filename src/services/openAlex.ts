import type { LookupInput } from "../modules/externalMetadataResolver";

export class OpenAlexService {
  private static readonly BASE_URL = "https://api.openalex.org";

  public static async findRawRecord({ title, doi }: LookupInput): Promise<any | null> {
    const byDOI = doi ? await this.fetchByDOI(doi) : null;
    if (byDOI) {
      return byDOI;
    }
    if (!title) {
      return null;
    }
    try {
      const queryParams = new URLSearchParams({
        search: title,
        "per-page": "5",
      });
      const data = await this.requestJSON(`${this.BASE_URL}/works?${queryParams.toString()}`);
      const hits = data?.results || [];
      return hits[0] || null;
    } catch (error) {
      console.error("Error finding OpenAlex record:", error);
      return null;
    }
  }

  private static async fetchByDOI(doi: string): Promise<any | null> {
    try {
      const normalizedDOI = String(doi || "")
        .toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
        .replace(/^doi:\s*/, "")
        .trim();
      if (!normalizedDOI) {
        return null;
      }
      return await this.requestJSON(`${this.BASE_URL}/works/${encodeURIComponent(`doi:${normalizedDOI}`)}`);
    } catch (_error) {
      return null;
    }
  }

  private static async requestJSON(url: string): Promise<any> {
    const response = await (Zotero.HTTP.request as any)("GET", url, {
      headers: {
        Accept: "application/json",
      },
      responseType: "json",
    });
    if (!response.status || response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAlex API error: ${response.status}`);
    }
    return response.response;
  }

  public static restoreAbstract(invertedIndex: unknown): string {
    if (!invertedIndex || typeof invertedIndex !== "object") {
      return "";
    }
    const wordsByPosition: string[] = [];
    for (const [word, positions] of Object.entries(invertedIndex as Record<string, unknown>)) {
      if (!Array.isArray(positions)) {
        continue;
      }
      for (const position of positions) {
        wordsByPosition[Number(position)] = word;
      }
    }
    return wordsByPosition
      .filter(Boolean)
      .join(" ")
      .replace(/\s+([,.;:!?])/g, "$1");
  }
}
