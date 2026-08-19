import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router";

import Blank from "./views/Blank.vue";

export const routes: RouteRecordRaw[] = [
    { path: "/", name: "Loading", component: Blank, meta: { icon: "line-md:loading-loop" } },
    {
        path: "/home",
        name: "Home",
        component: () => import("./views/Home.vue"),
        meta: { icon: "fluent:home-32-filled" },
    },
    {
        path: "/migration",
        name: "Migration",
        component: () => import("./views/Migration.vue"),
        meta: { icon: "fluent:home-32-filled" },
    },
    {
        path: "/setup",
        name: "SetupUI",
        component: () => import("./views/SetupUI.vue"),
        meta: { icon: "fluent-mdl2:install-to-drive" },
    },
    {
        path: "/apps",
        name: "Apps",
        component: () => import("./views/Apps.vue"),
        meta: { icon: "fluent:apps-32-filled" },
    },
    {
        path: "/configuration",
        name: "Configuration",
        component: () => import("./views/Config.vue"),
        meta: { icon: "icon-park-outline:config" },
    },
    {
        path: "/about",
        name: "About",
        component: () => import("./views/About.vue"),
        meta: { icon: "fluent:info-32-filled" },
    },
];

export const router = createRouter({
    history: createMemoryHistory(),
    routes,
});
