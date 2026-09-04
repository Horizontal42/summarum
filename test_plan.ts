// Just to check what fails in node with codemirror
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

try {
  const state = EditorState.create({doc: "hello"});
  console.log("State OK");
} catch(e) {
  console.log("State Error", e);
}
