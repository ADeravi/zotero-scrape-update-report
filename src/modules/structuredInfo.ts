import { ExternalMetadata, ExternalMetadataResolver } from "./externalMetadataResolver";
import { KeywordExtractor } from "./keywordExtractor";

type IdentityCheckRow = {
  field: string;
  current: string;
  external: string;
  status: "Matched" | "Not matched" | "Missing current" | "Missing external" | "Missing";
  reason: string;
  isMismatch: boolean;
};

export class StructuredInfoExtractor {
  private static readonly NOTE_HEADING_PREFIX = "Scrape report |";
  private static readonly LEGACY_NOTE_MARKER = "Metadata Scraper: Paper-content information";

  public static async oneClickUpdateItem(item: Zotero.Item): Promise<boolean | "cancelled"> {
    if (!this.isSupportedItem(item)) {
      return false;
    }
    const externalInfo = await ExternalMetadataResolver.fetchForItem(item);
    if (!externalInfo.records.length) {
      if (this.hasExternalIdentityRejection(externalInfo)) {
        await this.createDiscrepancyErrorReportNote(item, externalInfo, this.getIdentityCheckRows(item, externalInfo));
      }
      return false;
    }
    const identityChecks = this.getIdentityCheckRows(item, externalInfo);
    const discrepancies = this.getIdentityDiscrepancies(identityChecks);
    if (discrepancies.length) {
      await this.createDiscrepancyErrorReportNote(item, externalInfo, identityChecks);
      if (!(await this.confirmDiscrepancyUpdate(discrepancies, identityChecks))) {
        return "cancelled";
      }
    }

    const noteInfo = await this.ensurePaperContentNote(item);
    await this.updatePaperContentNote(noteInfo.note, externalInfo, noteInfo.firstCreated);
    return this.updateBibliographicMetadataFields(item, externalInfo);
  }

  private static getIdentityCheckRows(item: Zotero.Item, externalInfo: ExternalMetadata): IdentityCheckRow[] {
    const merged = externalInfo.merged || {};
    return [
      this.buildIdentityCheckRow("Title", this.getItemField(item, "title"), merged.title, (value) =>
        ExternalMetadataResolver.normalizeTitle(value),
      ),
      this.buildIdentityCheckRow("Date", this.getItemField(item, "date"), merged.date || merged.year, (value) =>
        this.normalizeDateForComparison(value),
      ),
      this.buildIdentityCheckRow("DOI", this.getItemField(item, "DOI"), merged.doi, (value) =>
        ExternalMetadataResolver.normalizeDOI(value),
      ),
    ];
  }

  private static buildIdentityCheckRow(
    field: string,
    currentValue: unknown,
    externalValue: unknown,
    normalize: (value: unknown) => string,
  ): IdentityCheckRow {
    const current = this.cleanPlainText(currentValue);
    const external = this.cleanPlainText(externalValue);
    if (!current && !external) {
      return {
        field,
        current,
        external,
        status: "Missing",
        reason: `${field} is missing in both Zotero and the external metadata.`,
        isMismatch: false,
      };
    }
    if (!current) {
      return {
        field,
        current,
        external,
        status: "Missing current",
        reason: `${field} is available externally but missing in Zotero.`,
        isMismatch: false,
      };
    }
    if (!external) {
      return {
        field,
        current,
        external,
        status: "Missing external",
        reason: `${field} is available in Zotero but missing from the trusted external metadata.`,
        isMismatch: false,
      };
    }
    if (normalize(current) === normalize(external)) {
      return {
        field,
        current,
        external,
        status: "Matched",
        reason: `${field} matches after normalization.`,
        isMismatch: false,
      };
    }
    return {
      field,
      current,
      external,
      status: "Not matched",
      reason: `${field} differs between Zotero and the trusted external metadata.`,
      isMismatch: true,
    };
  }

  private static getIdentityDiscrepancies(identityChecks: IdentityCheckRow[]) {
    return identityChecks
      .filter((check) => check.isMismatch)
      .map((check) => ({
        field: check.field,
        current: check.current,
        external: check.external,
      }));
  }

  private static hasExternalIdentityRejection(externalInfo: ExternalMetadata): boolean {
    return (externalInfo.crossChecks || []).some((check) =>
      /No trusted external records|Rejected /i.test(String(check || "")),
    );
  }

  private static confirmDiscrepancyUpdate(
    discrepancies: Array<{ field: string; current: string; external: string }>,
    identityChecks: IdentityCheckRow[],
  ) {
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
      const matchedFields = identityChecks
        .filter((check) => check.status === "Matched")
        .map((check) => check.field)
        .join(", ");
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
                  "A trusted external record was found, but some Zotero identity fields differ. Review the differences below. Choose Update to apply the external title, date, and metadata, or Cancel to stop the scrape update.",
              },
            },
            {
              tag: "description",
              styles: {
                width: "680px",
                marginBottom: "8px",
              },
              properties: {
                value: matchedFields
                  ? `Matched identity field(s): ${matchedFields}.`
                  : "No identity fields matched cleanly; only update if you are sure this is the same paper.",
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
    identityChecks: IdentityCheckRow[],
  ) {
    const createdDate = new Date();
    const note = new Zotero.Item("note");
    note.libraryID = item.libraryID;
    note.parentID = item.id;
    (note as any).setNote(
      this.buildDiscrepancyErrorReportHTML(
        item,
        externalInfo,
        identityChecks,
        this.formatDateTime(createdDate),
        this.formatDateDDMMYYYY(createdDate),
      ),
    );
    await note.saveTx();
  }

  private static buildDiscrepancyErrorReportHTML(
    item: Zotero.Item,
    externalInfo: ExternalMetadata,
    identityChecks: IdentityCheckRow[],
    createdAt: string,
    createdDateLabel: string,
  ): string {
    const hasTrustedRecord = Boolean(externalInfo.records?.length);
    return [
      `<h1>Scrape error report | ${this.escapeHTML(createdDateLabel)}</h1>`,
      `<p><strong>Date created:</strong> ${this.escapeHTML(createdAt)}</p>`,
      "<h2>Reason</h2>",
      `<p>${this.escapeHTML(this.getDiscrepancyErrorReason(externalInfo, identityChecks))}</p>`,
      hasTrustedRecord
        ? this.buildIdentityMatchSummarySection(identityChecks)
        : this.buildRejectedCandidateSummarySection(item, externalInfo),
    ].join("");
  }

  private static getDiscrepancyErrorReason(externalInfo: ExternalMetadata, identityChecks: IdentityCheckRow[]): string {
    if (!externalInfo.records?.length) {
      return "No trusted external record matched the Zotero item identity.";
    }
    const mismatched = identityChecks
      .filter((check) => check.isMismatch)
      .map((check) => check.field)
      .join(", ");
    const matched = identityChecks
      .filter((check) => check.status === "Matched")
      .map((check) => check.field)
      .join(", ");
    return [
      mismatched
        ? `${mismatched} differs between Zotero and the trusted external metadata.`
        : "External metadata requires review before updating Zotero fields.",
      matched ? `${matched} matched.` : "No identity field matched cleanly.",
    ].join(" ");
  }

  private static buildIdentityMatchSummarySection(identityChecks: IdentityCheckRow[]): string {
    const rows = identityChecks.map(
      (check) =>
        `<li><strong>${this.escapeHTML(check.field)}:</strong> ${this.escapeHTML(check.status)}. Current Zotero: ${this.escapeHTML(
          check.current || "Not available",
        )} | External record: ${this.escapeHTML(check.external || "Not available")}. ${this.escapeHTML(
          check.reason,
        )}</li>`,
    );
    return `<h2>What matched / what did not</h2><ul>${rows.join("")}</ul>`;
  }

  private static buildRejectedCandidateSummarySection(item: Zotero.Item, externalInfo: ExternalMetadata): string {
    const candidates = externalInfo.rejectedRecords || [];
    if (!candidates.length) {
      return this.buildListSection("What matched / what did not", externalInfo.crossChecks || []);
    }
    const rows = candidates.map((candidate) => {
      const checks = [
        this.buildIdentityCheckRow("Title", this.getItemField(item, "title"), candidate.title, (value) =>
          ExternalMetadataResolver.normalizeTitle(value),
        ),
        this.buildIdentityCheckRow("Date", this.getItemField(item, "date"), candidate.date, (value) =>
          this.normalizeDateForComparison(value),
        ),
        this.buildIdentityCheckRow("DOI", this.getItemField(item, "DOI"), candidate.doi, (value) =>
          ExternalMetadataResolver.normalizeDOI(value),
        ),
      ];
      const matched = checks
        .filter((check) => check.status === "Matched")
        .map((check) => check.field)
        .join(", ");
      const notMatched = checks
        .filter((check) => check.status === "Not matched")
        .map((check) => `${check.field} (${check.current || "not available"} vs ${check.external || "not available"})`)
        .join("; ");
      const missing = checks
        .filter((check) => check.status.startsWith("Missing"))
        .map((check) => `${check.field}: ${check.status.toLowerCase()}`)
        .join("; ");
      return `<li><strong>${this.escapeHTML(candidate.source)}:</strong> ${this.escapeHTML(
        candidate.reason,
      )}. Matched: ${this.escapeHTML(matched || "None")}. Not matched: ${this.escapeHTML(
        notMatched || "None",
      )}. Missing: ${this.escapeHTML(missing || "None")}.</li>`;
    });
    return `<h2>What matched / what did not</h2><ul>${rows.join("")}</ul>`;
  }

  private static findManagedPaperContentNote(item: Zotero.Item): Zotero.Item | null {
    try {
      const noteIDs = item.getNotes?.() || [];
      for (const noteID of noteIDs) {
        const note = Zotero.Items.get(noteID);
        if (note?.isNote?.() && this.isManagedPaperContentNoteHTML(String((note as any).getNote?.() || ""))) {
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
    const legacyMatch = html.match(/Metadata Scraper First Created:\s*([^<\n]+)/);
    if (legacyMatch?.[1]) {
      return legacyMatch[1].replace(/-->.*/, "").trim();
    }
    const visibleMatch = html.match(/<strong>\s*Date first created:\s*<\/strong>\s*([^<]+)/i);
    return visibleMatch?.[1]?.trim() || "";
  }

  private static buildPlaceholderNoteHTML(firstCreated: string): string {
    return [
      `<h1>Scrape report | ${this.escapeHTML(this.formatDateDDMMYYYY(new Date()))}</h1>`,
      `<p><strong>Date first created:</strong> ${this.escapeHTML(firstCreated)}</p>`,
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
      `<h1>Scrape report | ${this.escapeHTML(updatedDateLabel)}</h1>`,
      `<p><strong>Title:</strong> ${this.escapeHTML(title)}</p>`,
      `<p><strong>Date first created:</strong> ${this.escapeHTML(firstCreated)}</p>`,
      `<p><strong>Date updated:</strong> ${this.escapeHTML(updatedAt)}</p>`,
      this.buildPaperContentDetailsHTML(externalInfo, false),
    ].join("");
  }

  private static isManagedPaperContentNoteHTML(html: string): boolean {
    if (html.includes(this.LEGACY_NOTE_MARKER)) {
      return true;
    }
    const noteTitle = html.match(/<h1[^>]*>\s*([^<]+)/i)?.[1] || "";
    const cleanTitle = this.cleanPlainText(noteTitle).replace(/^X(?=Scrape report\s*\|)/i, "");
    return cleanTitle.startsWith(this.NOTE_HEADING_PREFIX);
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
