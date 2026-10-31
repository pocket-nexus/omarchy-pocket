// @title Omarchy Pocket
import Shell from "./app.tsx";
import { mount } from "@pocketjs/framework/solid";

// a failure while the shell mounts names its line: the host prints the
// exception, this prints where it was thrown (console.log reaches stderr)
try {
  mount(() => <Shell />);
} catch (error) {
  console.log("omarchy-pocket: mount failed:", String(error), (error as Error).stack ?? "");
  throw error;
}
