import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Panelshift",
    short_name: "Panelshift",
    description: "Responsive Komga-backed comic and webtoon reader",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#151713",
    theme_color: "#151713",
    categories: ["books", "entertainment"],
    icons: [
      {
        src: "/icons/panelshift.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/panelshift-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
