import * as bibtexParse from "@orcid/bibtex-parse-js";
import type { LookupInput } from "../modules/externalMetadataResolver";
import { getPref } from "../utils/prefs";

export interface Author {
  name: string;
  authorId?: string;
}

export interface PaperMetadata {
  title: string;
  authors: Author[];
  abstract?: string;
  year?: number;
  venue?: string;
  doi?: string;
  citationCount?: number;
  bibtex?: string;
}

export interface SemanticScholarResponse {
  paperId: string;
  corpusId?: number;
  url?: string;
  title: string;
  abstract?: string;
  year?: number;
  venue?: string;
  authors: Array<{
    authorId?: string;
    name: string;
  }>;
  doi?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  fieldsOfStudy?: string[];
  s2FieldsOfStudy?: Array<{ category?: string; source?: string }>;
  externalIds?: Record<string, string>;
  publicationTypes?: string[];
  publicationDate?: string;
  journal?: {
    name?: string;
    volume?: string;
    pages?: string;
    publisher?: string;
  };
  tldr?: {
    text?: string;
  };
  openAccessPdf?: {
    url?: string;
  };
  isOpenAccess?: boolean;
  citationStyles?: {
    bibtex: string;
  };
}

export class SemanticScholarService {
  private static readonly BASE_URL = "https://api.semanticscholar.org/graph/v1";
  private static readonly PAPER_FIELDS =
    "paperId,corpusId,url,title,abstract,venue,year,authors,citationCount,influentialCitationCount,referenceCount,citationStyles,fieldsOfStudy,s2FieldsOfStudy,externalIds,publicationTypes,publicationDate,journal,tldr,openAccessPdf,isOpenAccess";

  public static async searchByTitle(title: string): Promise<bibtexParse.BibtexEntry[]> {
    try {
      const queryParams = new URLSearchParams({
        query: title,
        limit: "10",
        fields: this.PAPER_FIELDS,
      });

      const data = await this.requestJSON(`${this.BASE_URL}/paper/search?${queryParams.toString()}`);
      const hits = data.data || [];

      return Promise.all(hits.map((hit: SemanticScholarResponse) => this.parseHit(hit)));
    } catch (error) {
      console.error("Error fetching from Semantic Scholar:", error);
      return [];
    }
  }

  public static async findRawRecord({ title, doi }: LookupInput): Promise<SemanticScholarResponse | null> {
    const byDOI = doi ? await this.fetchByID(`DOI:${doi}`) : null;
    if (byDOI) {
      return byDOI;
    }
    if (!title) {
      return null;
    }
    try {
      const queryParams = new URLSearchParams({
        query: title,
        limit: "5",
        fields: this.PAPER_FIELDS,
      });
      const data = await this.requestJSON(`${this.BASE_URL}/paper/search?${queryParams.toString()}`);
      const hits = data?.data || [];
      return hits[0] || null;
    } catch (error) {
      console.error("Error finding Semantic Scholar record:", error);
      return null;
    }
  }

  private static async fetchByID(id: string): Promise<SemanticScholarResponse | null> {
    try {
      const queryParams = new URLSearchParams({
        fields: this.PAPER_FIELDS,
      });
      return await this.requestJSON(`${this.BASE_URL}/paper/${encodeURIComponent(id)}?${queryParams.toString()}`);
    } catch (_error) {
      return null;
    }
  }

  private static async requestJSON(url: string): Promise<any> {
    const apiKey = getPref("semanticScholarAPIKey");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const response = await (Zotero.HTTP.request as any)("GET", url, {
      headers,
      responseType: "json",
    });

    if (!response.status || response.status !== 200) {
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    return response.response;
  }

  public static getFieldKeywords(data: SemanticScholarResponse): string[] {
    const fieldsOfStudy = data.fieldsOfStudy || [];
    const s2FieldsOfStudy = (data.s2FieldsOfStudy || [])
      .map((field) => field.category || field.source || "")
      .filter(Boolean);
    return [...new Set([...fieldsOfStudy, ...s2FieldsOfStudy].filter(Boolean))];
  }

  private static parseHit(data: SemanticScholarResponse): bibtexParse.BibtexEntry {
    const bibText = data.citationStyles?.bibtex;
    if (bibText) {
      const parsed = bibtexParse.toJSON(bibText);
      const result = parsed[0];
      const fieldKeywords = this.getFieldKeywords(data);
      if (result?.entryTags) {
        result.entryTags.abstract ||= data.abstract || "";
        result.entryTags.venue ||= data.venue || "";
        if (fieldKeywords.length) {
          result.entryTags.keywords = [result.entryTags.keywords, fieldKeywords.join("; ")].filter(Boolean).join("; ");
        }
      }
      return result;
    }

    return {
      citationKey: data.paperId || "semantic-scholar",
      entryType: "article",
      entryTags: {
        title: data.title || "",
        author: (data.authors || [])
          .map((author) => author.name)
          .filter(Boolean)
          .join(" and "),
        year: data.year ? String(data.year) : "",
        doi: data.externalIds?.DOI || data.doi || "",
        url: data.url || "",
        abstract: data.abstract || "",
        venue: data.venue || data.journal?.name || "",
        keywords: this.getFieldKeywords(data).join("; "),
      },
    };
  }
}
