import { registerRoot, Composition } from "remotion";
import { Daily } from "./Daily";
import { build } from "./tld.mjs";
const Root = () => <Composition id="Daily" component={Daily} durationInFrames={600} fps={60} width={1080} height={1920} defaultProps={{}} calculateMetadata={({ props }) => ({ durationInFrames: build(props).DUR })} />;
registerRoot(Root);
