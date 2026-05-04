# Changelog

## 1.0.3 - 2026-05-05

- Prevent duplicate Scrape, Update & Report entries in the Zotero item right-click menu by using a stable menu id and cleaning up older matching entries before registration.
- Clean up the right-click menu entry during window unload and plugin shutdown.
- Rename release XPI packages to `Scrape, Update & Report V[version].xpi`.

## 1.0.2 - 2026-05-04

- Allow exact DOI matches to reach the Update/Cancel confirmation modal even when the external title differs from Zotero.
- Show date mismatches in the same confirmation modal so the user can either apply the external metadata or cancel the update.
- Simplify scrape error notes to the reason for the error plus a concise summary of what matched and what did not.
- Record rejected external candidates with their source, reason, title, date, and DOI so error notes are easier to audit.

## 1.0.1 - 2026-05-03

- Removed hidden note marker comments that could appear as a leading `X` before generated scrape report note titles.
- Kept backward compatibility so existing managed scrape report notes are still found and updated in place.

## 1.0.0 - 2026-05-03

Initial public release of Scrape, Update & Report.

- Forked from Creling/Zotero-Metadata-Scraper under AGPL-3.0-or-later.
- Renamed the plugin to Scrape, Update & Report.
- Added one-click DBLP, Semantic Scholar, and OpenAlex metadata lookup.
- Added safe identity matching across title, DOI, and date.
- Added guard against DOI records with conflicting title/year metadata.
- Added discrepancy modal with Update and Cancel actions.
- Added child scrape report notes.
- Added child error report notes for unsafe metadata states.
- Added keyword extraction/tagging from external metadata.
- Added theme-aware pickaxe icons.
- Expanded Zotero compatibility range to Zotero 7 through Zotero 9.
