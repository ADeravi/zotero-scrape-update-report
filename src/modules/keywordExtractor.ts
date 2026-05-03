import type * as bibtexParse from "@orcid/bibtex-parse-js";

export class KeywordExtractor {
  private static readonly MAX_KEYWORDS = 18;
  private static readonly STOP_WORDS = new Set([
    "about",
    "after",
    "also",
    "among",
    "analysis",
    "based",
    "between",
    "data",
    "different",
    "effect",
    "effects",
    "from",
    "have",
    "into",
    "method",
    "methods",
    "model",
    "models",
    "paper",
    "research",
    "result",
    "results",
    "show",
    "study",
    "system",
    "systems",
    "that",
    "their",
    "these",
    "this",
    "through",
    "using",
    "with",
  ]);

  public static extractFromBibtex(result: bibtexParse.BibtexEntry, limit = this.MAX_KEYWORDS): string[] {
    const tags = result.entryTags || {};
    const explicitKeywords = this.splitKeywordString([tags.keywords, tags.keyword].filter(Boolean).join("; "));
    if (explicitKeywords.length) {
      return this.dedupe(explicitKeywords).slice(0, limit);
    }
    const sourceText = [tags.title, tags.abstract, tags.note, tags.journal, tags.booktitle, tags.venue]
      .filter(Boolean)
      .join(" ");
    return this.extract(sourceText, limit);
  }

  public static addTags(item: Zotero.Item, keywords: string[]): number {
    const existing = new Set(
      ((item.getTags?.() || []) as Array<{ tag?: string } | string>).map((tag) =>
        this.normalizeKeyword(typeof tag === "string" ? tag : tag.tag || "").toLowerCase(),
      ),
    );
    let added = 0;
    for (const keyword of this.dedupe(keywords)) {
      const normalized = this.normalizeKeyword(keyword);
      if (!normalized || existing.has(normalized.toLowerCase())) {
        continue;
      }
      item.addTag(normalized);
      existing.add(normalized.toLowerCase());
      added++;
    }
    return added;
  }

  public static splitKeywordString(raw: string): string[] {
    if (!raw) {
      return [];
    }
    return String(raw)
      .split(/[;,|]/)
      .map((keyword) => this.normalizeKeyword(keyword))
      .filter(Boolean);
  }

  public static extract(text: string, limit = this.MAX_KEYWORDS): string[] {
    const words = this.tokenize(text);
    if (!words.length) {
      return [];
    }
    const candidates = new Map<string, number>();
    const addCandidate = (parts: string[], weight: number) => {
      if (!this.isCandidatePhrase(parts)) {
        return;
      }
      const candidate = parts.join(" ");
      candidates.set(candidate, (candidates.get(candidate) || 0) + weight);
    };
    for (let i = 0; i < words.length; i++) {
      if (words[i].length > 3) {
        addCandidate([words[i]], 1);
      }
      if (i < words.length - 1) {
        addCandidate([words[i], words[i + 1]], 2.5);
      }
      if (i < words.length - 2) {
        addCandidate([words[i], words[i + 1], words[i + 2]], 3.5);
      }
    }
    const selected: string[] = [];
    const sortedCandidates = [...candidates.entries()].sort((a, b) => {
      const scoreDiff = b[1] - a[1];
      if (scoreDiff) {
        return scoreDiff;
      }
      const lengthDiff = b[0].split(" ").length - a[0].split(" ").length;
      if (lengthDiff) {
        return lengthDiff;
      }
      return a[0].localeCompare(b[0]);
    });
    for (const [candidate] of sortedCandidates) {
      const normalized = this.normalizeKeyword(candidate);
      if (!normalized || selected.some((keyword) => keyword.includes(normalized) || normalized.includes(keyword))) {
        continue;
      }
      selected.push(normalized);
      if (selected.length >= limit) {
        break;
      }
    }
    return selected;
  }

  public static normalizeKeyword(keyword: string): string {
    return String(keyword || "")
      .toLowerCase()
      .replace(/[`"{}()[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  public static dedupe(keywords: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const keyword of keywords) {
      const normalized = this.normalizeKeyword(keyword);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(normalized);
    }
    return deduped;
  }

  private static tokenize(text: string): string[] {
    return (
      String(text || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/['']/g, "")
        .match(/[a-z][a-z0-9-]{2,}/g) || []
    );
  }

  private static isCandidatePhrase(words: string[]): boolean {
    return words.every((word) => this.isCandidateWord(word)) && !words.every((word) => word === words[0]);
  }

  private static isCandidateWord(word: string): boolean {
    return word.length > 2 && !this.STOP_WORDS.has(word) && !/^\d/.test(word);
  }
}
