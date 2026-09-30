import test from "node:test";
import assert from "node:assert/strict";
import { createLoadingScreen } from "../src/loading-screen.js";

test("the loading veil lifts on the first frame or on failure", () => {
  const root = { dataset: {}, hidden: false, querySelector: () => null };
  const doc = { querySelector: () => root, defaultView: { matchMedia: () => ({ matches: true }) } };
  createLoadingScreen({ document: doc }).ready();
  assert.equal(root.hidden, true);
  root.hidden = false;
  createLoadingScreen({ document: doc }).fail(new Error("no adapter"));
  assert.equal(root.hidden, true);
  const absent = createLoadingScreen({ document: { querySelector: () => null } });
  absent.ready(); absent.fail(); absent.dispose();
});
