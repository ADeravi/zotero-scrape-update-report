import { ExternalMetadata, ExternalMetadataResolver } from "./externalMetadataResolver";
import { KeywordExtractor } from "./keywordExtractor";

export class StructuredInfoExtractor {
  private static readonly NOTE_MARKER = "Metadata Scraper: Paper-content information";
  private static readonly NOTE_FIRST_CREATED_PREFIX = "Metadata Scraper First Created:";

  public static async oneClickUpdateItem(item: Zotero.Item): Promise<boolean | "cancelled"> {
    if (!this.isSupportedItem(item)) {
      return false;
    }
    const externalInfo = await ExternalMetadataResolver.fetchForItem(item);
    if (!externalInfo.records.length) {
      if (this.hasExternalIdentityRejection(externalInfo)) {
        await this.createDiscrepancyErrorReportNote(item, externalInfo, this.buildNoTrustedMatchDiscrepancies(item));
      }
      return false;
    }
    const discrepancies = this.getIdentityDiscrepancies(item, externalInfo);
    if (discrepancies.length) {
      await this.createDiscrepancyErrorReportNote(item, externalInfo, discrepancies);
      if (!(await this.confirmDiscrepancyUpdate(discrepancies))) {
        return "cancelled";
      }
    }

    const noteInfo = await this.ensurePaperContentNote(item);
    await this.updatePaperContentNote(noteInfo.note, externalInfo, noteInfo.firstCreated);
    return this.updateBibliographicMetadataFields(item, externalInfo);
  }

  private static getIdentityDiscrepancies(item: Zotero.Item, externalInfo: ExternalMetadata) {
    const merged = externalInfo.merged || {};
    const checks = [
      {
        field: "Title",
        current: this.getItemField(item, "title"),
        external: merged.title,
        normalize: (value: unknown) => ExternalMetadataResolver.normalizeTitle(value),
      },
      {
        field: "Date",
        current: this.getItemField(item, "date"),
        external: merged.date || merged.year,
        normalize: (value: unknown) => this.normalizeDateForComparison(value),
      },
      {
        field: "DOI",
        current: this.getItemField(item, "DOI"),
        external: merged.doi,
        normalize: (value: unknown) => ExternalMetadataResolver.normalizeDOI(value),
      },
    ];
    return checks
      .filter((check) => {
        const current = this.cleanPlainText(check.current);
        const external = this.cleanPlainText(check.external);
        if (!current || !external) {
          return false;
        }
        return check.normalize(current) !== check.normalize(external);
      })
      .map((check) => ({
        field: check.field,
        current: this.cleanPlainText(check.current),
        external: this.cleanPlainText(check.external),
      }));
  }

  private static hasExternalIdentityRejection(externalInfo: ExternalMetadata): boolean {
    return (externalInfo.crossChecks || []).some((check) =>
      /No trusted external records|Rejected /i.test(String(check || "")),
    );
  }

  private static buildNoTrustedMatchDiscrepancies(item: Zotero.Item) {
    return [
      {
        field: "External lookup",
        current: [
          `Title: ${this.getItemField(item, "title") || "Not available"}`,
          `Date: ${this.getItemField(item, "date") || "Not available"}`,
          `DOI: ${this.getItemField(item, "DOI") || "Not available"}`,
        ].join("; "),
        external: "No trusted external record matched the Zotero title, date, and DOI.",
      },
    ];
  }

  private static confirmDiscrepancyUpdate(discrepancies: Array<{ field: string; current: string; external: string }>) {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (shouldUpdate: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(shouldUpdate);
      };
      const rows = discrepancies.flatMap((difference) => [
        {
          tag: "label",
          styles: {
            fontWeight: "bold",
            marginTop: "8px",
          },
          properties: {
            value: difference.field,
          },
        },
        {
          tag: "description",
          styles: {
            width: "680px",
            marginTop: "2px",
          },
          properties: {
            value: `Current Zotero: ${difference.current}`,
          },
        },
        {
          tag: "description",
          styles: {
            width: "680px",
            marginTop: "2px",
          },
          properties: {
            value: `External record: ${difference.external}`,
          },
        },
      ]);
      const dialog = new (ztoolkit as any).Dialog(1, 1);
      dialog.dialogData.loadCallback = () => this.applyDiscrepancyDialogTheme(dialog);
      dialog.dialogData.unloadCallback = () => finish(false);
      dialog
        .addCell(0, 0, {
          tag: "vbox",
          id: "metadata-scraper-discrepancy-content",
          children: [
            {
              tag: "label",
              styles: {
                fontWeight: "bold",
                fontSize: "15px",
                margin: "0 0 8px 0",
              },
              properties: {
                value: "Metadata discrepancy detected",
              },
            },
            {
              tag: "description",
              styles: {
                width: "680px",
                marginBottom: "8px",
              },
              properties: {
                value:
                  "The external record does not match the current Zotero title, date, or DOI. Choose Update to force the external metadata onto the item, or Cancel to stop the scrape update.",
              },
            },
            ...rows,
          ],
        })
        .addButton("Update", "update", {
          callback: () => finish(true),
        })
        .addButton("Cancel", "cancel", {
          callback: () => finish(false),
        })
        .open("Metadata discrepancy", {
          centerscreen: true,
          resizable: true,
        });
    });
  }

  private static applyDiscrepancyDialogTheme(dialog: any): void {
    const doc = dialog.window?.document;
    if (!doc || doc.getElementById("metadata-scraper-discrepancy-theme")) {
      return;
    }
    const style = doc.createElement("style");
    style.id = "metadata-scraper-discrepancy-theme";
    style.textContent = `
      :root { color-scheme: light dark; }
      html, body { background: #f8fafc !important; color: #111827 !important; }
      body, label, description { color: #111827 !important; }
      #metadata-scraper-discrepancy-content {
        background: #ffffff !important;
        color: #111827 !important;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 16px;
        max-width: 720px;
      }
      button {
        background: #ffffff !important;
        color: #111827 !important;
        border: 1px solid #9ca3af !important;
        border-radius: 6px !important;
        min-width: 88px;
        padding: 6px 14px !important;
      }
      button:hover { background: #f3f4f6 !important; }
      button#update {
        background: #1d4ed8 !important;
        border-color: #1d4ed8 !important;
        color: #ffffff !important;
      }
      button#update:hover { background: #1e40af !important; }
      button#cancel {
        background: #ffffff !important;
        color: #111827 !important;
      }
      @media (prefers-color-scheme: dark) {
        html, body { background: #0f172a !important; color: #f8fafc !important; }
        body, label, description { color: #f8fafc !important; }
        #metadata-scraper-discrepancy-content {
          background: #111827 !important;
          color: #f8fafc !important;
          border-color: #374151;
        }
        button {
          background: #1f2937 !important;
          color: #f8fafc !important;
          border-color: #64748b !important;
        }
        button:hover { background: #334155 !important; }
        button#update {
          background: #2563eb !important;
          border-color: #60a5fa !important;
          color: #ffffff !important;
        }
        button#update:hover { background: #1d4ed8 !important; }
        button#cancel {
          background: #1f2937 !important;
          color: #f8fafc !important;
        }
      }
    `;
    doc.head.appendChild(style);
  }

  private static async updateBibliographicMetadataFields(
    item: Zotero.Item,
    externalInfo: ExternalMetadata,
  ): Promise<boolean> {
    if (!this.isSupportedItem(item) || !externalInfo.records.length) {
      return false;
    }
    const merged = externalInfo.merged || {};
    const itemType = this.inferZoteroItemType(merged);
    this.setItemType(item, itemType);
    this.setField(item, "title", merged.title);
    this.setField(item, "date", merged.date || merged.year);
    this.setField(item, "DOI", merged.doi);
    this.setField(item, "url", merged.url);
    this.setField(item, "abstractNote", merged.abstract);
    this.setField(item, "volume", merged.volume);
    this.setField(item, "issue", merged.issue);
    this.setField(item, "pages", merged.pages);
    this.setField(item, "publisher", merged.publisher);
    this.setField(item, "language", merged.language);
    this.setPublicationFields(item, itemType, merged);
    if (merged.authors?.length) {
      item.setCreators(this.formatCreators(merged.authors as string[]) as any);
    }
    KeywordExtractor.addTags(item, (merged.keywords || []) as string[]);
    await item.saveTx();
    return true;
  }

  private static async ensurePaperContentNote(item: Zotero.Item) {
    const existingNote = this.findManagedPaperContentNote(item);
    if (existingNote) {
      return {
        note: existingNote,
        firstCreated: this.getFirstCreatedFromNote(existingNote) || this.formatDateTime(new Date()),
      };
    }
    const firstCreated = this.formatDateTime(new Date());
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    (note as any).setNote(this.buildPlaceholderNoteHTML(firstCreated));
    await note.saveTx();
    return { note, firstCreated };
  }

  private static async updatePaperContentNote(note: Zotero.Item, externalInfo: ExternalMetadata, firstCreated: string) {
    const updatedDate = new Date();
    (note as any).setNote(
      this.buildPaperContentNoteHTML(
        externalInfo,
        firstCreated,
        this.formatDateTime(updatedDate),
        this.formatDateDDMMYYYY(updatedDate),
      ),
    );
    await note.saveTx();
  }

  private static async createDiscrepancyErrorReportNote(
    item: Zotero.Item,
    externalInfo: ExternalMetadata,
    discrepancies: Array<{ field: string; current: string; external: string }>,
  ) {
    const createdDate = new Date();
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    (note as any).setNote(
      this.buildDiscrepancyErrorReportHTML(
        item,
        externalInfo,
        discrepancies,
        this.formatDateTime(createdDate),
        this.formatDateDDMMYYYY(createdDate),
      ),
    );
    await note.saveTx();
  }

  private static buildDiscrepancyErrorReportHTML(
    item: Zotero.Item,
    externalInfo: ExternalMetadata,
    discrepancies: Array<{ field: string; current: string; external: string }>,
    createdAt: string,
    createdDateLabel: string,
  ): string {
    const merged = externalInfo.merged || {};
    const records = externalInfo.records || [];
    const currentRows: Array<[string, unknown]> = [
      ["Title", this.getItemField(item, "title")],
      ["Date", this.getItemField(item, "date")],
      ["DOI", this.getItemField(item, "DOI")],
    ];
    const externalRows: Array<[string, unknown]> = [
      ["Title", merged.title],
      ["Date", merged.date || merged.year],
      ["DOI", merged.doi],
      ["Sources", (merged.sources || []).join(", ")],
    ];
    return [
      "<!-- Metadata Scraper: Error report -->",
      `<h1>Scrape error report | ${this.escapeHTML(createdDateLabel)}</h1>`,
      `<p><strong>Date created:</strong> ${this.escapeHTML(createdAt)}</p>`,
      "<p><strong>Status:</strong> Metadata update needs review because external metadata did not safely match the Zotero item identity.</p>",
      this.buildTableSection("Current Zotero identity", currentRows),
      this.buildTableSection("External merged identity", externalRows),
      "<h2>Discrepancy</h2>",
      discrepancies.length
        ? `<ul>${discrepancies
            .map(
              (difference) =>
                `<li><strong>${this.escapeHTML(difference.field)}:</strong> Current Zotero: ${this.escapeHTML(
                  difference.current,
                )} | External record: ${this.escapeHTML(difference.external)}</li>`,
            )
            .join("")}</ul>`
        : "<p>No field-level discrepancy details were available.</p>",
      this.buildListSection("Source cross-check", externalInfo.crossChecks || []),
      this.buildListSection(
        "External records considered",
        records.map((record) =>
          [
            record.source,
            record.title && `Title: ${record.title}`,
            (record.date || record.year) && `Date: ${record.date || record.year}`,
            record.doi && `DOI: ${record.doi}`,
          ]
            .filter(Boolean)
            .join(" | "),
        ),
      ),
      "<h2>Action</h2>",
      "<p>No standard Zotero fields should be changed unless the discrepancy is intentionally accepted from the modal.</p>",
    ].join("");
  }

  private static findManagedPaperContentNote(item: Zotero.Item): Zotero.Item | null {
    try {
      const noteIDs = item.getNotes?.() || [];
      for (const noteID of noteIDs) {
        const note = Zotero.Items.get(noteID);
        if (note?.isNote?.() && String((note as any).getNote?.() || "").includes(this.NOTE_MARKER)) {
          return note;
        }
      }
    } catch (_error) {
      // Ignore note lookup failures and create a new managed note.
    }
    return null;
  }

  private static getFirstCreatedFromNote(note: Zotero.Item): string {
    const html = String((note as any).getNote?.() || "");
    const match = html.match(/Metadata Scraper First Created:\s*([^<\n]+)/);
    return match?.[1]?.replace(/-->.*/, "").trim() || "";
  }

  private static buildPlaceholderNoteHTML(firstCreated: string): string {
    return [
      `<!-- ${this.NOTE_MARKER} -->`,
      `<!-- ${this.NOTE_FIRST_CREATED_PREFIX} ${this.escapeHTML(firstCreated)} -->`,
      `<h1>Scrape report | ${this.escapeHTML(this.formatDateDDMMYYYY(new Date()))}</h1>`,
      "<p><strong>Status:</strong> Preparing external metadata lookup.</p>",
    ].join("");
  }

  private static buildPaperContentNoteHTML(
    externalInfo: ExternalMetadata,
    firstCreated: string,
    updatedAt: string,
    updatedDateLabel: string,
  ): string {
    const title = externalInfo.merged.title || "Untitled external record";
    return [
      `<!-- ${this.NOTE_MARKER} -->`,
      `<!-- ${this.NOTE_FIRST_CREATED_PREFIX} ${this.escapeHTML(firstCreated)} -->`,
      `<h1>Scrape report | ${this.escapeHTML(updatedDateLabel)}</h1>`,
      `<p><strong>Title:</strong> ${this.escapeHTML(title)}</p>`,
      `<p><strong>Date first created:</strong> ${this.escapeHTML(firstCreated)}</p>`,
      `<p><strong>Date updated:</strong> ${this.escapeHTML(updatedAt)}</p>`,
      this.buildPaperContentDetailsHTML(externalInfo, false),
    ].join("");
  }

  private static buildPaperContentDetailsHTML(externalInfo: ExternalMetadata, includeTitle = true): string {
    const merged = externalInfo.merged || {};
    const title = merged.title || "Untitled external record";
    const abstract = merged.abstract || "";
    const keywords = this.mergeUnique((merged.keywords || []) as string[]);
    const fieldsOfStudy = this.mergeUnique((merged.fieldsOfStudy || []) as string[]);
    const topic = fieldsOfStudy.slice(0, 5).join("; ") || keywords.slice(0, 5).join("; ") || title;
    const focus = merged.tldr || this.extractFirstSentence(abstract) || "Not available from external abstracts.";
    const methodSignals = this.findSignals(abstract, [
      "simulation",
      "model",
      "experiment",
      "survey",
      "interview",
      "case study",
      "ethnography",
      "systematic review",
      "literature review",
      "scoping review",
      "randomized",
      "regression",
      "machine learning",
      "probabilistic",
      "bayesian",
      "qualitative",
      "quantitative",
      "mixed methods",
    ]);
    const findingSignals = this.findSentences(
      abstract,
      /\b(find|finds|finding|findings|found|show|shows|showed|result|results|suggest|suggests|demonstrate|demonstrates|indicate|indicates)\b/i,
    );
    const limitationSignals = this.findSentences(
      abstract,
      /\b(limit|limits|limited|limitation|limitations|future work|future research)\b/i,
    );
    const metadataRows = [
      ["Sources", (merged.sources || []).join(", ")],
      ["DOI", merged.doi],
      ["Publication / venue", merged.publication || merged.venue],
      ["Publisher", merged.publisher],
      ["Publication date", merged.date || merged.year],
      ["Submission date", merged.submittedDate],
      ["External record created", merged.createdDate],
      ["External record updated", merged.updatedDate],
      ["Open access", merged.isOpenAccess],
      ["Open access PDF", merged.openAccessPdf],
      ["Semantic Scholar ID", merged.semanticScholarId],
      ["Semantic Scholar Corpus ID", merged.corpusId],
      ["OpenAlex ID", merged.openAlexId],
      ["Retraction flag", merged.isRetracted],
      ["FWCI", merged.fwci],
    ];
    return [
      ...(includeTitle ? [`<p><strong>Title:</strong> ${this.escapeHTML(title)}</p>`] : []),
      "<h2>Core Content</h2>",
      `<p><strong>Topic:</strong> ${this.escapeHTML(topic)}</p>`,
      `<p><strong>Research focus:</strong> ${this.escapeHTML(focus)}</p>`,
      `<p><strong>Method or evidence signals:</strong> ${this.escapeHTML(
        methodSignals.join("; ") || "Not available from external abstracts.",
      )}</p>`,
      `<p><strong>Key finding signals:</strong> ${this.escapeHTML(
        findingSignals.join(" ") || "Not available from external abstracts.",
      )}</p>`,
      `<p><strong>Limitations or future-work signals:</strong> ${this.escapeHTML(
        limitationSignals.join(" ") || "Not available from external abstracts.",
      )}</p>`,
      this.buildListSection("Keywords", keywords),
      this.buildListSection("External fields / topics", fieldsOfStudy),
      "<h2>External Metadata and Provenance</h2>",
      ...metadataRows
        .filter(([, value]) => Boolean(value))
        .map(
          ([label, value]) =>
            `<p><strong>${this.escapeHTML(label)}:</strong> ${this.escapeHTML(this.cleanPlainText(value))}</p>`,
        ),
      `<p><strong>Citation context:</strong> ${this.escapeHTML(this.formatCitationContext(merged))}</p>`,
      this.buildListSection("Cross-check", externalInfo.crossChecks || []),
      "<h2>Update Basis</h2>",
      "<p>Generated from DBLP, Semantic Scholar, and OpenAlex external records only. The Zotero item title/DOI was used only to find matching records. The full abstract is written to Zotero's standard Abstract field, not repeated in this note.</p>",
    ].join("");
  }

  private static buildTableSection(title: string, rows: Array<[string, unknown]>): string {
    const visibleRows = rows
      .map(([label, value]) => [label, this.cleanPlainText(value)])
      .filter(([, value]) => Boolean(value));
    if (!visibleRows.length) {
      return `<h2>${this.escapeHTML(title)}</h2><p>Not available.</p>`;
    }
    return `<h2>${this.escapeHTML(title)}</h2><table>${visibleRows
      .map(([label, value]) => `<tr><th>${this.escapeHTML(label)}</th><td>${this.escapeHTML(value)}</td></tr>`)
      .join("")}</table>`;
  }

  private static buildListSection(title: string, values: string[]): string {
    const uniqueValues = this.mergeUnique(values);
    if (!uniqueValues.length) {
      return `<h2>${this.escapeHTML(title)}</h2><p>Not available from external records.</p>`;
    }
    return `<h2>${this.escapeHTML(title)}</h2><ul>${uniqueValues
      .map((value) => `<li>${this.escapeHTML(value)}</li>`)
      .join("")}</ul>`;
  }

  private static isSupportedItem(item: Zotero.Item): boolean {
    return Boolean(item && typeof item.isRegularItem === "function" && item.isRegularItem());
  }

  private static inferZoteroItemType(merged: ExternalMetadata["merged"]): string {
    const rawType = String(merged.itemType || "").toLowerCase();
    const venue = String(merged.venue || merged.publication || "").toLowerCase();
    const raw = `${rawType} ${venue}`;
    if (/conference|proceeding|inproceedings/.test(raw)) {
      return "conferencePaper";
    }
    if (/book[-\s]?chapter|book section|incollection/.test(raw)) {
      return "bookSection";
    }
    if (/thesis|dissertation/.test(raw)) {
      return "thesis";
    }
    if (/dataset/.test(raw)) {
      return "dataset";
    }
    if (/software/.test(raw)) {
      return "software";
    }
    if (/report|technical report|techreport/.test(raw)) {
      return "report";
    }
    if (/preprint/.test(raw)) {
      return "preprint";
    }
    if (/book/.test(raw) && !/journal/.test(raw)) {
      return "book";
    }
    return "journalArticle";
  }

  private static setItemType(item: Zotero.Item, itemType: string): void {
    try {
      const itemTypeID = Zotero.ItemTypes.getID(itemType);
      if (typeof itemTypeID === "number" && item.itemTypeID !== itemTypeID) {
        item.setType(itemTypeID);
      }
    } catch (_error) {
      // Keep existing type when Zotero rejects an inferred type.
    }
  }

  private static setPublicationFields(item: Zotero.Item, itemType: string, merged: ExternalMetadata["merged"]): void {
    const publication = merged.publication || merged.venue;
    if (!publication) {
      return;
    }
    if (itemType === "conferencePaper") {
      this.setField(item, "proceedingsTitle", publication);
      this.setField(item, "conferenceName", merged.venue || publication);
      return;
    }
    if (itemType === "bookSection") {
      this.setField(item, "bookTitle", publication);
      return;
    }
    if (itemType === "preprint") {
      this.setField(item, "repository", publication);
      return;
    }
    this.setField(item, "publicationTitle", publication);
  }

  private static setField(item: Zotero.Item, field: string, value: unknown): boolean {
    const cleanValue = this.cleanPlainText(value);
    if (!cleanValue) {
      return false;
    }
    try {
      item.setField(field as any, cleanValue);
      return true;
    } catch (_error) {
      return false;
    }
  }

  private static formatCreators(authors: string[]) {
    return authors.map((author) => this.parseCreatorName(author)).filter(Boolean) as Array<{
      firstName?: string;
      lastName: string;
      creatorType: string;
    }>;
  }

  private static parseCreatorName(author: string) {
    const name = String(author || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) {
      return null;
    }
    if (name.includes(",")) {
      const [lastName, ...rest] = name
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return {
        firstName: rest.join(" "),
        lastName,
        creatorType: "author",
      };
    }
    const parts = name.split(" ");
    if (parts.length === 1) {
      return {
        lastName: parts[0],
        creatorType: "author",
      };
    }
    return {
      firstName: parts.slice(0, -1).join(" "),
      lastName: parts.slice(-1)[0],
      creatorType: "author",
    };
  }

  private static getItemField(item: Zotero.Item, field: string): string {
    try {
      return String(item.getField(field as any) || "");
    } catch (_error) {
      return "";
    }
  }

  private static findSignals(text: unknown, terms: string[]): string[] {
    const lowerText = String(text || "").toLowerCase();
    return terms.filter((term) => lowerText.includes(term));
  }

  private static findSentences(text: unknown, matcher: RegExp, limit = 2): string[] {
    return this.splitSentences(text)
      .filter((sentence) => matcher.test(sentence))
      .slice(0, limit);
  }

  private static splitSentences(text: unknown): string[] {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 20);
  }

  private static extractFirstSentence(text: unknown): string {
    return this.splitSentences(text)[0] || "";
  }

  private static formatCitationContext(merged: ExternalMetadata["merged"]): string {
    return (
      [
        merged.citationCount && `Citations: ${merged.citationCount}`,
        merged.influentialCitationCount && `Influential citations: ${merged.influentialCitationCount}`,
        merged.referenceCount && `References: ${merged.referenceCount}`,
        merged.fwci && `FWCI: ${merged.fwci}`,
      ]
        .filter(Boolean)
        .join("; ") || "Not available from external records."
    );
  }

  private static mergeUnique(values: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const value of values || []) {
      const normalized = this.cleanPlainText(value);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(normalized);
    }
    return merged;
  }

  private static formatDateTime(date: Date): string {
    return date
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, " UTC");
  }

  private static formatDateDDMMYYYY(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${date.getFullYear()}`;
  }

  private static normalizeDateForComparison(value: unknown): string {
    const text = this.cleanPlainText(value);
    const year = text.match(/\b(18|19|20|21)\d{2}\b/)?.[0];
    return year || text.toLowerCase();
  }

  private static cleanPlainText(value: unknown): string {
    return String(Array.isArray(value) ? value.join("; ") : value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static escapeHTML(value: unknown): string {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
