import type * as bibtexParse from "@orcid/bibtex-parse-js";
import { DBLPService } from "../services/dblp";
import { KeywordExtractor } from "./keywordExtractor";
import { OpenAlexService } from "../services/openAlex";
import { SemanticScholarResponse, SemanticScholarService } from "../services/semanticScholar";

export interface LookupInput {
  title: string;
  doi: string;
  year?: string;
}

export interface ExternalRecord {
  source: string;
  title: string;
  authors: string[];
  year: string;
  date: string;
  doi: string;
  url: string;
  venue: string;
  publication: string;
  publisher: string;
  itemType: string;
  abstract?: string;
  tldr?: string;
  keywords: string[];
  fieldsOfStudy: string[];
  citationCount?: string;
  influentialCitationCount?: string;
  referenceCount?: string;
  openAccessPdf?: string;
  isOpenAccess?: string;
  semanticScholarId?: string;
  corpusId?: string;
  openAlexId?: string;
  language?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  submittedDate?: string;
  createdDate?: string;
  updatedDate?: string;
  isRetracted?: string;
  fwci?: string;
  sourceURL?: string;
}

export interface ExternalMetadata {
  lookup: LookupInput;
  records: ExternalRecord[];
  merged: Partial<ExternalRecord> & {
    sources?: string[];
  };
  crossChecks: string[];
}

export class ExternalMetadataResolver {
  private static readonly MIN_TITLE_MATCH_SCORE = 0.78;

  public static async fetchForItem(item: Zotero.Item): Promise<ExternalMetadata> {
    const lookup = this.getLookupFromItem(item);
    if (!lookup.title && !lookup.doi) {
      return {
        lookup,
        records: [],
        merged: {},
        crossChecks: ["No title or DOI available for external lookup."],
      };
    }

    const [dblpResult, semanticScholarResult, openAlexResult] = await Promise.allSettled([
      this.fetchDBLPRecord(lookup),
      SemanticScholarService.findRawRecord(lookup),
      OpenAlexService.findRawRecord(lookup),
    ]);
    const records = [
      this.parseDBLPRecord(this.settledValue(dblpResult)),
      this.parseSemanticScholarRecord(this.settledValue(semanticScholarResult)),
      this.parseOpenAlexRecord(this.settledValue(openAlexResult)),
    ].filter(Boolean) as ExternalRecord[];
    const filtered = this.filterIdentityMatches(lookup, records);

    return {
      lookup,
      records: filtered.records,
      merged: this.mergeRecords(filtered.records),
      crossChecks: this.buildCrossChecks(filtered.records, filtered.rejected),
    };
  }

  private static getLookupFromItem(item: Zotero.Item): LookupInput {
    return {
      title: this.getItemField(item, "title"),
      doi: this.normalizeDOI(this.getItemField(item, "DOI")),
      year: this.extractYear(this.getItemField(item, "date")),
    };
  }

  private static async fetchDBLPRecord({ title }: LookupInput): Promise<bibtexParse.BibtexEntry | null> {
    if (!title) {
      return null;
    }
    const results = await DBLPService.searchByTitle(title);
    return (
      this.pickBestTitleMatch(
        title,
        results.map((result) => ({
          title: result.entryTags?.title || "",
          data: result,
        })),
      )?.data || null
    );
  }

  private static parseDBLPRecord(result: bibtexParse.BibtexEntry | null): ExternalRecord | null {
    if (!result?.entryTags) {
      return null;
    }
    const tags = result.entryTags;
    return {
      source: "DBLP",
      title: tags.title || "",
      authors: this.splitBibtexAuthors(tags.author),
      year: tags.year || "",
      date: tags.year || "",
      doi: this.normalizeDOI(tags.doi),
      url: tags.url || "",
      venue: tags.journal || tags.booktitle || tags.venue || "",
      publication: tags.journal || tags.booktitle || tags.venue || "",
      publisher: tags.publisher || "",
      itemType: result.entryType || "",
      volume: tags.volume || "",
      issue: tags.number || tags.issue || "",
      pages: tags.pages || "",
      keywords: KeywordExtractor.extractFromBibtex(result),
      fieldsOfStudy: [],
      sourceURL: tags.url || "",
    };
  }

  private static parseSemanticScholarRecord(data: SemanticScholarResponse | null): ExternalRecord | null {
    if (!data) {
      return null;
    }
    const fieldsOfStudy = SemanticScholarService.getFieldKeywords(data);
    const externalIds = data.externalIds || {};
    return {
      source: "Semantic Scholar",
      title: data.title || "",
      authors: (data.authors || []).map((author) => author.name).filter(Boolean),
      year: data.year ? String(data.year) : "",
      date: data.publicationDate || (data.year ? String(data.year) : ""),
      doi: this.normalizeDOI(externalIds.DOI || externalIds.Doi || externalIds.doi || data.doi),
      url: data.url || "",
      venue: data.venue || data.journal?.name || "",
      publication: data.journal?.name || data.venue || "",
      publisher: data.journal?.publisher || "",
      itemType: (data.publicationTypes || []).join("; "),
      abstract: data.abstract || "",
      tldr: data.tldr?.text || "",
      keywords: fieldsOfStudy,
      fieldsOfStudy,
      citationCount: this.formatNumber(data.citationCount),
      influentialCitationCount: this.formatNumber(data.influentialCitationCount),
      referenceCount: this.formatNumber(data.referenceCount),
      openAccessPdf: data.openAccessPdf?.url || "",
      isOpenAccess: typeof data.isOpenAccess === "boolean" ? String(data.isOpenAccess) : "",
      semanticScholarId: data.paperId || "",
      corpusId: data.corpusId ? String(data.corpusId) : "",
      submittedDate: data.publicationDate || "",
      sourceURL: data.url || "",
    };
  }

  private static parseOpenAlexRecord(data: any | null): ExternalRecord | null {
    if (!data) {
      return null;
    }
    const authors = (data.authorships || []).map((authorship: any) => authorship.author?.display_name).filter(Boolean);
    const source = data.primary_location?.source;
    const biblio = data.biblio || {};
    const concepts = (data.concepts || [])
      .filter((concept: any) => (concept.score || 0) >= 0.3)
      .map((concept: any) => concept.display_name)
      .filter(Boolean);
    const topics = (data.topics || []).map((topic: any) => topic.display_name).filter(Boolean);
    const keywords = (data.keywords || [])
      .map((keyword: any) => keyword.display_name || keyword.keyword)
      .filter(Boolean);
    const primaryTopic = data.primary_topic?.display_name ? [data.primary_topic.display_name] : [];
    return {
      source: "OpenAlex",
      title: data.display_name || data.title || "",
      authors,
      year: data.publication_year ? String(data.publication_year) : "",
      date: data.publication_date || (data.publication_year ? String(data.publication_year) : ""),
      doi: this.normalizeDOI(data.doi),
      url: data.primary_location?.landing_page_url || data.id || "",
      venue: source?.display_name || "",
      publication: source?.display_name || "",
      publisher: source?.host_organization_name || source?.publisher || data.host_venue?.publisher || "",
      itemType: data.type || "",
      abstract: OpenAlexService.restoreAbstract(data.abstract_inverted_index),
      keywords: KeywordExtractor.dedupe([...primaryTopic, ...topics, ...keywords, ...concepts]),
      fieldsOfStudy: KeywordExtractor.dedupe([...primaryTopic, ...topics, ...concepts]),
      citationCount: this.formatNumber(data.cited_by_count),
      referenceCount: this.formatNumber(data.referenced_works_count),
      openAccessPdf: data.primary_location?.pdf_url || data.open_access?.oa_url || "",
      isOpenAccess: data.open_access?.is_oa !== undefined ? String(data.open_access.is_oa) : "",
      openAlexId: data.id || "",
      language: data.language || "",
      volume: biblio.volume || "",
      issue: biblio.issue || "",
      pages: [biblio.first_page, biblio.last_page].filter(Boolean).join("-"),
      isRetracted: typeof data.is_retracted === "boolean" ? String(data.is_retracted) : "",
      fwci: data.fwci !== null && data.fwci !== undefined ? String(data.fwci) : "",
      createdDate: data.created_date || "",
      updatedDate: data.updated_date || "",
      sourceURL: data.id || "",
    };
  }

  public static mergeRecords(records: ExternalRecord[]): ExternalMetadata["merged"] {
    const get = (field: keyof ExternalRecord) => this.preferred(records, field);
    const keywords = KeywordExtractor.dedupe(records.flatMap((record) => record.keywords || []));
    const fieldsOfStudy = KeywordExtractor.dedupe(records.flatMap((record) => record.fieldsOfStudy || []));
    return {
      title: get("title") as string,
      authors: this.preferredAuthors(records),
      year: get("year") as string,
      date: get("date") as string,
      doi: get("doi") as string,
      url: get("url") as string,
      venue: get("venue") as string,
      publication: get("publication") as string,
      publisher: get("publisher") as string,
      itemType: get("itemType") as string,
      abstract: get("abstract") as string,
      tldr: get("tldr") as string,
      keywords,
      fieldsOfStudy,
      citationCount: get("citationCount") as string,
      influentialCitationCount: get("influentialCitationCount") as string,
      referenceCount: get("referenceCount") as string,
      openAccessPdf: get("openAccessPdf") as string,
      isOpenAccess: get("isOpenAccess") as string,
      language: get("language") as string,
      volume: get("volume") as string,
      issue: get("issue") as string,
      pages: get("pages") as string,
      openAlexId: get("openAlexId") as string,
      semanticScholarId: get("semanticScholarId") as string,
      corpusId: get("corpusId") as string,
      submittedDate: get("submittedDate") as string,
      createdDate: get("createdDate") as string,
      updatedDate: get("updatedDate") as string,
      isRetracted: get("isRetracted") as string,
      fwci: get("fwci") as string,
      sources: records.map((record) => record.source),
    };
  }

  public static buildCrossChecks(records: ExternalRecord[], rejected: string[] = []): string[] {
    if (!records.length) {
      return ["No trusted external records matched the Zotero title, DOI, and date.", ...rejected];
    }
    const checks = [
      this.compareField(records, "Title", "title", (value) => this.normalizeTitle(value)),
      this.compareField(records, "DOI", "doi", (value) => this.normalizeDOI(value)),
      this.compareField(records, "Year", "year", (value) => String(value || "").trim()),
      this.compareField(records, "Venue", "venue", (value) => this.normalizeText(value)),
    ].filter(Boolean) as string[];
    return [`Sources found: ${records.map((record) => record.source).join(", ")}`, ...checks, ...rejected];
  }

  public static pickBestTitleMatch<T extends { title: string; data: unknown }>(
    title: string,
    candidates: T[],
  ): T | null {
    const normalizedTitle = this.normalizeTitle(title);
    if (!normalizedTitle || !candidates.length) {
      return null;
    }
    const best =
      candidates
        .map((candidate) => ({
          ...candidate,
          score: this.titleSimilarity(normalizedTitle, this.normalizeTitle(candidate.title)),
        }))
        .sort((a, b) => b.score - a.score)[0] || null;
    return best && best.score >= this.MIN_TITLE_MATCH_SCORE ? best : null;
  }

  public static normalizeDOI(value: unknown): string {
    return String(value || "")
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
      .replace(/^doi:\s*/, "")
      .trim();
  }

  public static normalizeTitle(value: unknown): string {
    return this.normalizeText(value)
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  public static normalizeText(value: unknown): string {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  public static extractYear(value: unknown): string {
    return String(value || "").match(/\b(18|19|20|21)\d{2}\b/)?.[0] || "";
  }

  private static preferred(
    records: ExternalRecord[],
    field: keyof ExternalRecord,
  ): ExternalRecord[keyof ExternalRecord] | "" {
    const sourceOrder = ["Semantic Scholar", "OpenAlex", "DBLP"];
    for (const source of sourceOrder) {
      const value = records.find((record) => record.source === source)?.[field];
      if (Array.isArray(value) ? value.length : value) {
        return value;
      }
    }
    return "";
  }

  private static preferredAuthors(records: ExternalRecord[]): string[] {
    const value = this.preferred(records, "authors");
    return Array.isArray(value) ? value : [];
  }

  private static compareField(
    records: ExternalRecord[],
    label: string,
    field: keyof ExternalRecord,
    normalize: (value: unknown) => string,
  ): string {
    const values = records
      .map((record) => ({
        source: record.source,
        raw: record[field],
        normalized: normalize(record[field]),
      }))
      .filter((entry) => entry.normalized);
    if (!values.length) {
      return `${label}: unavailable from external sources`;
    }
    const unique = [...new Set(values.map((entry) => entry.normalized))];
    if (unique.length === 1) {
      return `${label}: confirmed by ${values.map((entry) => entry.source).join(", ")}`;
    }
    return `${label}: differs across sources (${values
      .map((entry) => `${entry.source}: ${this.cleanPlainText(entry.raw)}`)
      .join(" | ")})`;
  }

  private static filterIdentityMatches(lookup: LookupInput, records: ExternalRecord[]) {
    const accepted: ExternalRecord[] = [];
    const rejected: string[] = [];
    for (const record of records) {
      const match = this.identityMatch(lookup, record);
      if (match.accept) {
        accepted.push(record);
      } else {
        rejected.push(`Rejected ${record.source}: ${match.reason}`);
      }
    }
    return { records: accepted, rejected };
  }

  private static identityMatch(
    lookup: LookupInput,
    record: ExternalRecord,
  ): { accept: true } | { accept: false; reason: string } {
    const lookupDOI = this.normalizeDOI(lookup.doi);
    const recordDOI = this.normalizeDOI(record.doi);
    const lookupTitle = this.normalizeTitle(lookup.title);
    const recordTitle = this.normalizeTitle(record.title);
    const titleScore = this.titleSimilarity(lookupTitle, recordTitle);
    const lookupYear = this.extractYear(lookup.year);
    const recordYear = this.extractYear(record.date || record.year);
    if (lookupDOI && recordDOI) {
      if (lookupDOI !== recordDOI) {
        return { accept: false, reason: `DOI mismatch (${record.doi || "missing"})` };
      }
      if (lookupTitle && recordTitle && titleScore < this.MIN_TITLE_MATCH_SCORE) {
        return { accept: false, reason: `DOI matches but title conflicts (${this.formatScore(titleScore)})` };
      }
      if (lookupYear && recordYear && lookupYear !== recordYear) {
        return { accept: false, reason: `DOI matches but year conflicts (${recordYear})` };
      }
      return { accept: true };
    }
    if (lookupDOI && !recordDOI && titleScore < this.MIN_TITLE_MATCH_SCORE) {
      return { accept: false, reason: `missing DOI and weak title match (${this.formatScore(titleScore)})` };
    }
    if (!lookupDOI && titleScore < this.MIN_TITLE_MATCH_SCORE) {
      return { accept: false, reason: `weak title match (${this.formatScore(titleScore)})` };
    }
    if (lookupYear && recordYear && lookupYear !== recordYear && titleScore < 0.95) {
      return {
        accept: false,
        reason: `date/year mismatch (${recordYear}) with title match ${this.formatScore(titleScore)}`,
      };
    }
    return { accept: true };
  }

  private static titleSimilarity(a: string, b: string): number {
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }
    const aTokens = new Set(a.split(" ").filter(Boolean));
    const bTokens = new Set(b.split(" ").filter(Boolean));
    const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
    const union = new Set([...aTokens, ...bTokens]).size || 1;
    return intersection / union;
  }

  private static splitBibtexAuthors(authors: string | undefined): string[] {
    return String(authors || "")
      .split(" and ")
      .map((author) => author.trim())
      .filter(Boolean);
  }

  private static getItemField(item: Zotero.Item, field: string): string {
    try {
      return String(item.getField(field as any) || "");
    } catch (_error) {
      return "";
    }
  }

  private static cleanPlainText(value: unknown): string {
    return String(Array.isArray(value) ? value.join("; ") : value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static formatNumber(value: unknown): string {
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  private static formatScore(value: number): string {
    return `${Math.round((value || 0) * 100)}%`;
  }

  private static settledValue<T>(result: PromiseSettledResult<T>): T | null {
    return result.status === "fulfilled" ? result.value : null;
  }
}
