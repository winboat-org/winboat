import { openExternal, showItemInFolder } from "../lib/electron";

export function openLink(link: string) {
    if (link.startsWith("http")) {
        return openExternal(link);
    } else {
        return showItemInFolder(link);
    }
}

export function openAnchorLink(e: MouseEvent) {
    e.preventDefault();
    const target = e.target as HTMLAnchorElement;
    const href = target.getAttribute("href");
    if (href) {
        openLink(href);
    }
}
