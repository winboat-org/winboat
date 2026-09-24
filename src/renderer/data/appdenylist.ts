import { type WinApp } from "../../types";

/**
 * Locale-independent rules for apps hidden from the default "Apps" view.
 * NEVER match on app.Name — display names are localized (e.g. Polish systems).
 *
 * - `uwpPfnPrefixes`: matched against the PackageFamilyName embedded in app.Args,
 *   since UWP apps launch via `shell:AppsFolder\<PFN>!<AppId>` and apps.ps1
 *   does not expose the PFN as a separate field.
 * - `win32PathPatterns`: matched against app.Path (full exe/msc path).
 *
 * When adding rules, verify package names on a live guest with:
 *   Get-AppxPackage | Select-Object Name, PackageFamilyName
 */
export const HiddenAppRules = {
    uwpPfnPrefixes: [
        // Codecs & media/image format extensions
        "Microsoft.AV1VideoExtension",
        "Microsoft.AVCEncoderVideoExtension",
        "Microsoft.HEVCVideoExtension",
        "Microsoft.HEIFImageExtension",
        "Microsoft.MPEG2VideoExtension",
        "Microsoft.VP9VideoExtensions",
        "Microsoft.WebMediaExtensions",
        "Microsoft.WebpImageExtension",
        "Microsoft.RawImageExtension",
        // Feed / support / marketing
        "Microsoft.BingNews",
        "Microsoft.BingSearch",
        "Microsoft.BingWeather",
        "Microsoft.GetHelp",
        "Microsoft.WindowsFeedbackHub",
        // Background Xbox plumbing (NOT XboxGamingOverlay/GamingApp — those stay)
        "Microsoft.XboxIdentityProvider",
        "Microsoft.XboxSpeechToTextOverlay",
        "Microsoft.Xbox.TCUI",
        "Microsoft.TCUI",
        // Runtimes & background components
        "Microsoft.WidgetsPlatformRuntime",
        "Microsoft.Windows.WebExperienceHost",
        "Microsoft.DesktopAppInstaller",
        "Microsoft.StorePurchaseApp",
        "Microsoft.SecHealthUI",
        "Microsoft.CrossDevice",
        "Microsoft.Windows.Contacts",
        "Microsoft.LanguageExperiencePack", // prefix covers all locale packs
    ],
    win32PathPatterns: [
        // All MMC snap-ins: services.msc, devmgmt.msc, diskmgmt.msc, eventvwr.msc,
        // taskschd.msc, wf.msc, perfmon.msc, comexp.msc, etc.
        /\\system32\\[a-z0-9 ]+\.msc$/i,
        /\\regedit\.exe$/i,
        // ODBC Administrator (32- and 64-bit copies)
        /\\odbcad32\.exe$/i,
        // Admin & diagnostic tools
        /\\system32\\msinfo32\.exe$/i,
        /\\system32\\msconfig\.exe$/i,
        /\\system32\\resmon\.exe$/i,
        /\\system32\\dfrgui\.exe$/i,
        /\\system32\\cleanmgr\.exe$/i,
        /\\system32\\recoverydrive\.exe$/i,
        /\\system32\\mdsched\.exe$/i,
        // Accessibility (host owns input/display in a remote session)
        /\\system32\\narrator\.exe$/i,
        /\\system32\\magnify\.exe$/i,
        /\\system32\\osk\.exe$/i,
        /\\system32\\tabtip\.exe$/i,
        /\\system32\\voiceaccess\.exe$/i,
        /\\system32\\livecaptions\.exe$/i,
        // Legacy stub that just opens Edge
        /\\program files\\internet explorer\\iexplore\.exe$/i,
    ],
};

/**
 * Returns true when the app should be hidden from the default "Apps" view.
 * Internal apps and anything not matching a rule stay visible.
 */
export function isAppHiddenByDefault(app: WinApp): boolean {
    if (app.Source === "internal") {
        return false;
    }
    if (app.Source === "uwp") {
        const pfn = app.Args.replace(/^shell:AppsFolder\\/, "").split("!")[0].toLowerCase();
        return HiddenAppRules.uwpPfnPrefixes.some(prefix => pfn.startsWith(prefix.toLowerCase()));
    }
    return HiddenAppRules.win32PathPatterns.some(pattern => pattern.test(app.Path));
}
