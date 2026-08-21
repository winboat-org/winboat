import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./index.css";
import { autoScroll } from "./directives/autoscroll";
import { DEFAULT_HOMEBREW_DIR } from "./lib/constants";
import { initializeAppPath } from "./lib/electron";

const process: typeof import("process") = require("node:process");

/**
 * @note A big chunk of our userbase uses WinBoat under an immutable distro through GearLever.
 * In case it's the flatpak version of GearLever, PATH, and some other environment variables are stripped by default.
 * We include the default homebrew bin directory for exactly this reason.
 * It's not WinBoat's responsibility if the PATH envvar is incomplete, but in this case it affects a lot of users.
 */
process.env.PATH && (process.env.PATH += `:${DEFAULT_HOMEBREW_DIR}`);

if (import.meta.env.DEV) {
    await initializeAppPath();
}

createApp(App)
    .directive("auto-scroll", autoScroll)
    .use(router)
    .mount("#app");
