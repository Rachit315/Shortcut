import { Config } from "@remotion/cli/config";
import { existsSync } from "node:fs";

Config.setVideoImageFormat("png");
Config.setConcurrency(4);
Config.setChromiumOpenGlRenderer("swangle");

// Use a locally installed headless Chromium when present (CI/sandbox); otherwise Remotion downloads its own.
const local = process.env.REMOTION_CHROME ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (existsSync(local)) Config.setBrowserExecutable(local);
