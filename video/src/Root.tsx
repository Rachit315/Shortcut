import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import { Composition } from "remotion";
import { Demo } from "./Demo";
import T from "./timeline.json";

export const Root: React.FC = () => (
  <Composition id="ClazyDemo" component={Demo} durationInFrames={T.durationInFrames} fps={T.fps} width={1920} height={1080} />
);
