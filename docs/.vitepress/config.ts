import { defineConfig } from "vitepress";
import { vitepressPluginTypedoc } from "./plugins/vitepress-plugin-typedoc";
import typedocSidebar from "../websg-js/typedoc-sidebar.json";

// Where the docs are served. Inside the app it's /docs (dist/docs); scripts/buzzar/deploy-docs-haven.sh builds a
// copy for https://haven.software/buzzar/docs/ with DOCS_BASE=/buzzar/docs/ DOCS_OUT=../dist-docs-haven.
const base = (process.env.DOCS_BASE ?? "/docs/").replace(/\/?$/, "/");
const outDir = process.env.DOCS_OUT ?? "../dist/docs";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Buzzar",
  description: "Documentation for Buzzar, shared virtual worlds on Matrix",
  // Buzzar's internal planning and research notes live in docs/buzzar/ and aren't part of the site.
  srcExclude: ["buzzar/**"],
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}icon.svg` }]],
  base,
  outDir,
  themeConfig: {
    siteTitle: false,
    logo: { light: "/light-logo-full.svg", dark: "/dark-logo-full.svg", alt: "Buzzar" },
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Guides", link: "/guides/" },
      {
        text: "Reference",
        items: [
          { text: "WebSG JavaScript API", link: "/websg-js/" },
          { text: "glTF Extensions", link: "/gltf/" },
        ],
      },
    ],
    sidebar: {
      "/guides/": [
        { text: "Getting Started", link: "/guides/" },
        { text: "Creators", link: "/guides/creators" },
        { text: "Developers", link: "/guides/developers" },
        { text: "Avatars", link: "/guides/avatars" },
        { text: "Importing Worlds", link: "/guides/importing-worlds" },
        { text: "Coming from Third Room", link: "/guides/third-room" },
        {
          text: "Web Scene Graph",
          items: [
            { text: "Overview", link: "/guides/websg/" },
            {
              text: "Getting Started Tutorial",
              items: [
                { text: "Part 1: Interactables", link: "/guides/websg/basketball/part-1" },
                { text: "Part 2: Collisions and UI", link: "/guides/websg/basketball/part-2" },
                { text: "Part 3: Networking", link: "/guides/websg/basketball/part-3" },
              ],
            },
            { text: "Scene Graph", link: "/guides/websg/scenegraph" },
            { text: "Meshes", link: "/guides/websg/meshes" },
            { text: "Materials", link: "/guides/websg/materials" },
            { text: "Lighting", link: "/guides/websg/lighting" },
            { text: "Physics", link: "/guides/websg/physics" },
            { text: "ECS", link: "/guides/websg/ecs" },
            { text: "Action Bar", link: "/guides/websg/actionbar" },
            { text: "UI", link: "/guides/websg/ui" },
            { text: "Interactables", link: "/guides/websg/interactables" },
            { text: "Networking", link: "/guides/websg/networking" },
          ],
        },
        {
          text: "Unity Exporter",
          items: [
            { text: "Getting Started", link: "/guides/unity/" },
            {
              text: "Exporter GitHub Repository (Third Room)",
              link: "https://github.com/matrix-org/thirdroom-unity-exporter",
            },
          ],
        },
        {
          text: "Self Hosting",
          link: "/guides/self-hosting",
        },
        {
          text: "Community / Support",
          items: [
            {
              text: "GitHub Issues",
              link: "https://github.com/Haven-Organization/buzzar/issues",
            },
            {
              text: "Haven Software",
              link: "https://haven.software/buzzar/",
            },
          ],
        },
      ],
      // TODO: rename api -> websg-js when this issue is resolved:
      // https://github.com/tgreyuk/typedoc-plugin-markdown/issues/438
      "/websg-js/": typedocSidebar as any,
      "/gltf/": [
        { text: "Overview", link: "/gltf/" },
        {
          text: "Buzzar extensions",
          items: [
            { text: "HAVEN_avatar_pedestal", link: "/gltf/HAVEN_avatar_pedestal/README" },
            { text: "HAVEN_grabbable", link: "/gltf/HAVEN_grabbable/README" },
            { text: "HAVEN_mirror", link: "/gltf/HAVEN_mirror/README" },
            { text: "HAVEN_seat", link: "/gltf/HAVEN_seat/README" },
            { text: "HAVEN_climbable", link: "/gltf/HAVEN_climbable/README" },
          ],
        },
        {
          text: "Third Room extensions",
          items: [
            { text: "MX_background", link: "/gltf/MX_background/README" },
            { text: "MX_character_controller", link: "/gltf/MX_character_controller/README" },
            { text: "MX_lightmap", link: "/gltf/MX_lightmap/README" },
            { text: "MX_portal", link: "/gltf/MX_portal/README" },
            { text: "MX_postprocessing", link: "/gltf/MX_postprocessing/README" },
            { text: "MX_reflection_probes", link: "/gltf/MX_reflection_probes/README" },
            { text: "MX_scene_ar", link: "/gltf/MX_scene_ar/README" },
            { text: "MX_spawn_point", link: "/gltf/MX_spawn_point/README" },
            { text: "MX_texture_rgbm", link: "/gltf/MX_texture_rgbm/README" },
            { text: "MX_tiles_renderer", link: "/gltf/MX_tiles_renderer/README" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/Haven-Organization/buzzar" }],
    footer: {
      message: "Apache-2.0. Buzzar continues Third Room by the Matrix.org Foundation.",
      copyright: '<a href="https://haven.software/buzzar/">Haven Software</a>',
    },
    editLink: {
      pattern: "https://github.com/Haven-Organization/buzzar/edit/develop/docs/:path",
    },
  },
  // vite: {
  //   plugins: [vitepressPluginTypedoc()],
  // },
});
