import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: process.env.CAPACITOR_APP_ID ?? "com.panelshift.viewer",
  appName: "Panelshift",
  webDir: "capacitor-web",
  backgroundColor: "#151713",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
};

export default config;
