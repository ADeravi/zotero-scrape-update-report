import { StructuredInfoExtractor } from "./structuredInfo";
import { getString } from "../utils/locale";

export class MetadataUIFactory {
  public static registerPreferenceUI() {
    Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${addon.data.config.addonRef}/content/icons/pickaxe-theme.svg`,
    });
  }

  public static registerRightClickMenuItem() {
    const menuIcon = this.getThemedMenuIcon();
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      label: getString("menuitem-scrape-update-report"),
      icon: menuIcon,
      commandListener: async () => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || !items.length) {
          return;
        }
        await this.oneClickUpdate(items);
      },
    });
  }

  private static async oneClickUpdate(items: Zotero.Item[]): Promise<void> {
    const progressWin = new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("one-click-updating"),
        type: "default",
        progress: 0,
      })
      .show();
    let successCount = 0;
    const totalItems = items.length;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const success = await StructuredInfoExtractor.oneClickUpdateItem(item);
      if (success === "cancelled") {
        progressWin.changeLine({
          progress: (i / totalItems) * 100,
          text: getString("one-click-update-cancelled", {
            args: {
              successCount,
              totalItems,
            },
          }),
          type: "warning",
        });
        progressWin.startCloseTimer(5000);
        return;
      }
      if (success) {
        successCount++;
      }
      progressWin.changeLine({
        progress: ((i + 1) / totalItems) * 100,
        text: `[${i + 1}/${totalItems}] ${getString("one-click-updating")}`,
      });
    }
    progressWin.changeLine({
      text: getString("one-click-update-complete", {
        args: {
          successCount,
          totalItems,
        },
      }),
      progress: 100,
      type: successCount > 0 ? "success" : "warning",
    });
    progressWin.startCloseTimer(5000);
  }

  private static getThemedMenuIcon(): string {
    let isDark = false;
    try {
      const win = Zotero.getMainWindow();
      isDark = Boolean(
        win.matchMedia?.("(prefers-color-scheme: dark)")?.matches ||
          win.document?.documentElement?.classList?.contains("theme-dark") ||
          win.document?.documentElement?.getAttribute("data-color-scheme") === "dark",
      );
    } catch (_error) {
      // Fall back to light theme icon.
    }
    return `chrome://${addon.data.config.addonRef}/content/icons/pickaxe-${isDark ? "white" : "black"}.svg`;
  }
}
