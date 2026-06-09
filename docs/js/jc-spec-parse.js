/**
 * Shared OpenAPI spec parsing for JumpCloud docs (YAML or JSON).
 */
(function (global) {
  "use strict";

  var JumpCloudDocs = global.JumpCloudDocs || {};

  JumpCloudDocs.parseSpecDocument = function (text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) {
      throw new Error("Empty spec document");
    }
    var spec = trimmed.startsWith("{")
      ? JSON.parse(text)
      : global.jsyaml.load(text);
    if (!spec || typeof spec !== "object") {
      throw new Error("Invalid spec document");
    }
    return spec;
  };

  global.JumpCloudDocs = JumpCloudDocs;
})(typeof window !== "undefined" ? window : global);
