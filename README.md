# Scrape, Update & Report

Scrape, Update & Report is a Zotero plugin for one-click academic metadata scraping, safe field updates, keyword tagging, and discrepancy reports from DBLP, Semantic Scholar, and OpenAlex.

This repository is a maintained fork of [Creling/Zotero-Metadata-Scraper](https://github.com/Creling/Zotero-Metadata-Scraper). It remains licensed under AGPL-3.0-or-later.

## What It Does

- Adds one Zotero item context-menu command: **Scrape, Update & Report**.
- Looks up selected papers in DBLP, Semantic Scholar, and OpenAlex.
- Cross-checks external records against the Zotero item title, DOI, and date before writing fields.
- Updates standard Zotero bibliographic fields instead of putting bibliographic data into `Extra`.
- Writes abstracts to Zotero's standard Abstract field.
- Adds external keywords as Zotero tags.
- Creates or updates a child note headed `Scrape report | DD/MM/YYYY`.
- Creates a separate `Scrape error report | DD/MM/YYYY` child note when external metadata is unsafe or inconsistent.
- Uses a theme-aware pickaxe icon for light and dark Zotero themes.

## Safety Model

The plugin does not trust a DOI match by itself. External records are rejected when the DOI matches but the title or year strongly conflicts with the current Zotero item. This guards against corrupted provider records, including cases where OpenAlex maps a valid DOI to an unrelated work.

If a discrepancy is found, Zotero shows a modal with:

- current Zotero title/date/DOI
- external title/date/DOI
- **Update** to intentionally force the external update
- **Cancel** to stop the update

An error report note is created for auditability.

## Data Sources

- [DBLP](https://dblp.org/)
- [Semantic Scholar](https://www.semanticscholar.org/product/api)
- [OpenAlex](https://openalex.org/)

Semantic Scholar works without an API key, but an API key is recommended for higher rate limits.

## Installation

1. Download the latest `.xpi` file from this repository's releases.
2. In Zotero, open **Tools → Add-ons**.
3. Click the gear icon and choose **Install Add-on From File...**.
4. Select the downloaded `.xpi`.
5. Restart Zotero if prompted.

## Usage

1. Select one or more regular Zotero items.
2. Right-click the item selection.
3. Choose **Scrape, Update & Report**.
4. Review any discrepancy modal before allowing forced changes.

## Notes Created

### Scrape Report

The normal child note includes:

- title
- date first created
- date updated
- topic and research-focus signals
- method/evidence signals
- finding and limitation signals
- keywords
- external fields/topics
- provenance, identifiers, open-access, citation, FWCI, and retraction information where available
- source cross-checks

### Error Report

The error child note includes:

- current Zotero identity
- external merged identity
- discrepancy details
- source cross-checks
- external records considered
- a clear action warning

## Development

### Requirements

- Node.js 20+
- npm
- Zotero 7, 8, or 9

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

The scaffold writes build output under `.scaffold/build`.

### Development Server

```bash
npm run start
```

### Lint

```bash
npm run lint:check
npm run lint:fix
```

## Releasing

The release workflow is inherited from the upstream Zotero plugin scaffold. Tag a release with:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build and publish release assets when repository Actions are enabled.

## License and Attribution

Licensed under [AGPL-3.0-or-later](LICENSE).

Original project: [Creling/Zotero-Metadata-Scraper](https://github.com/Creling/Zotero-Metadata-Scraper), copyright creling.

This fork adds Zotero 9 compatibility range, one-click scrape/update/report flow, DBLP/Semantic Scholar/OpenAlex cross-checking, safer identity matching, discrepancy/error notes, keyword tagging, and theme-aware icon updates.
