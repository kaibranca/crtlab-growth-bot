import { registerRoot, Composition } from "remotion";
import { Reel } from "./Reel";
import { build } from "./tl.mjs";
const Root = () => <Composition id="Reel" component={Reel} durationInFrames={600} fps={60} width={1080} height={1920} defaultProps={{}} calculateMetadata={({ props }) => ({ durationInFrames: build(props).DUR })} />;
registerRoot(Root);
