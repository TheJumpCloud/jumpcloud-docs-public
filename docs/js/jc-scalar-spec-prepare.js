/**
 * Scalar mount helpers: spec prep, viewport sync, and support link wiring.
 */
(function (global) {
  "use strict";

  var JumpCloudDocs = global.JumpCloudDocs || {};

  function removeXInternalTrue(node) {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        removeXInternalTrue(node[i]);
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, "x-internal") && node["x-internal"] === true) {
      delete node["x-internal"];
    }
    var keys = Object.keys(node);
    for (var k = 0; k < keys.length; k++) {
      removeXInternalTrue(node[keys[k]]);
    }
  }

  function buildScalarCreateOptions(spec) {
    return Object.assign({}, global.__JC_SCALAR_CREATE_OPTS || {}, { content: spec });
  }

  var HTTP_METHODS = [
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "head",
    "options",
    "trace",
  ];

  function buildOperationPathHtml(method, path) {
    var key = String(method).toLowerCase();
    return (
      '<p class="jc-scalar-operation-path">' +
      '<span class="jc-scalar-http-method jc-scalar-http-method-' +
      key +
      '">' +
      key.toUpperCase() +
      "</span>" +
      '<span class="jc-scalar-http-path"> ' +
      path +
      "</span>" +
      "</p>"
    );
  }

  function prependOperationPaths(spec) {
    if (!spec || typeof spec !== "object") {
      return;
    }
    var paths = spec.paths;
    if (!paths || typeof paths !== "object") {
      return;
    }
    Object.keys(paths).forEach(function (path) {
      var pathItem = paths[path];
      if (!pathItem || typeof pathItem !== "object") {
        return;
      }
      Object.keys(pathItem).forEach(function (method) {
        if (HTTP_METHODS.indexOf(method) === -1) {
          return;
        }
        var operation = pathItem[method];
        if (!operation || typeof operation !== "object") {
          return;
        }
        if (
          typeof operation.description === "string" &&
          operation.description.indexOf("jc-scalar-operation-path") !== -1
        ) {
          return;
        }
        var pathHtml = buildOperationPathHtml(method, path);
        var body = typeof operation.description === "string" ? operation.description.trim() : "";
        operation.description = body ? pathHtml + "\n\n" + body : pathHtml + "\n";
      });
    });
  }

  var scalarApp = null;
  var viewportResizeObserver = null;
  var viewportResizeListenerAttached = false;

  function syncScalarViewportHeight() {
    var host = document.querySelector(".jc-scalar-scroll-host");
    if (!host) {
      return;
    }
    var height = host.clientHeight;
    if (height <= 0) {
      return;
    }
    var px = height + "px";
    host.style.setProperty("--jc-scalar-full-height", px);
    var layouts = host.querySelectorAll(".references-layout");
    for (var i = 0; i < layouts.length; i++) {
      layouts[i].style.setProperty("--full-height", px);
    }
  }

  function teardownScalarViewportSync() {
    if (viewportResizeObserver) {
      viewportResizeObserver.disconnect();
      viewportResizeObserver = null;
    }
    if (viewportResizeListenerAttached) {
      global.removeEventListener("resize", syncScalarViewportHeight);
      viewportResizeListenerAttached = false;
    }
  }

  function ensureScalarViewportResizeObserver() {
    if (viewportResizeObserver || typeof ResizeObserver === "undefined") {
      return;
    }
    var host = document.querySelector(".jc-scalar-scroll-host");
    if (!host) {
      return;
    }
    viewportResizeObserver = new ResizeObserver(function () {
      syncScalarViewportHeight();
    });
    viewportResizeObserver.observe(host);
    global.addEventListener("resize", syncScalarViewportHeight);
    viewportResizeListenerAttached = true;
  }

  function scheduleScalarViewportSync() {
    syncScalarViewportHeight();
    requestAnimationFrame(syncScalarViewportHeight);
    ensureScalarViewportResizeObserver();
    var attempts = 0;
    function waitForLayout() {
      var host = document.querySelector(".jc-scalar-scroll-host");
      if (host && host.querySelector(".references-layout")) {
        syncScalarViewportHeight();
        return;
      }
      if (attempts++ < 60) {
        requestAnimationFrame(waitForLayout);
      }
    }
    waitForLayout();
  }

  var DEFAULT_SUPPORT_URL = "https://jumpcloud.com/support/contact-jumpcloud-support";
  var DEFAULT_SUPPORT_LABEL = "JumpCloud Support";

  function getSupportLinkFromSpec(spec) {
    var contact = spec && spec.info && spec.info.contact;
    if (!contact || typeof contact !== "object") {
      return {
        url: DEFAULT_SUPPORT_URL,
        label: DEFAULT_SUPPORT_LABEL,
      };
    }
    var url = typeof contact.url === "string" ? contact.url.trim() : "";
    var label = typeof contact.name === "string" ? contact.name.trim() : "";
    return {
      url: url || DEFAULT_SUPPORT_URL,
      label: label || DEFAULT_SUPPORT_LABEL,
    };
  }

  function replaceSidebarSupportLink(support) {
    var host = document.querySelector(".jc-scalar-scroll-host");
    if (!host) {
      return false;
    }
    var link = host.querySelector('.darklight-reference a[href="https://www.scalar.com"]');
    if (!link) {
      return false;
    }
    link.setAttribute("href", support.url);
    link.textContent = " " + support.label + " ";
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("aria-label", support.label);
    link.classList.add("jc-scalar-support-link");
    return true;
  }

  function scheduleSidebarSupportLink(support) {
    replaceSidebarSupportLink(support);
    requestAnimationFrame(function () {
      replaceSidebarSupportLink(support);
    });
    var attempts = 0;
    function waitForFooter() {
      if (replaceSidebarSupportLink(support)) {
        return;
      }
      if (attempts++ < 60) {
        requestAnimationFrame(waitForFooter);
      }
    }
    waitForFooter();
  }

  JumpCloudDocs.destroyScalarApiReference = function () {
    if (scalarApp && typeof scalarApp.destroy === "function") {
      scalarApp.destroy();
    }
    scalarApp = null;
    teardownScalarViewportSync();
  };

  JumpCloudDocs.mountScalarApiReference = function (selector, spec) {
    removeXInternalTrue(spec);
    prependOperationPaths(spec);
    var support = getSupportLinkFromSpec(spec);
    scalarApp = global.Scalar.createApiReference(selector, buildScalarCreateOptions(spec));
    scheduleScalarViewportSync();
    scheduleSidebarSupportLink(support);
  };

  JumpCloudDocs.mountScalarFromUrl = async function (options) {
    var specUrl = options && options.specUrl;
    var selector = options && options.selector;
    if (!specUrl || !selector) {
      throw new Error("specUrl and selector are required");
    }
    var response = await fetch(specUrl);
    if (!response.ok) {
      throw new Error("Spec HTTP " + response.status);
    }
    var spec = JumpCloudDocs.parseSpecDocument(await response.text());
    JumpCloudDocs.mountScalarApiReference(selector, spec);
  };

  JumpCloudDocs.showScalarLoadError = function (selector) {
    var host = document.querySelector(selector);
    if (!host) {
      return;
    }
    host.innerHTML =
      '<p class="p-4 text-danger"><strong>Could not load API spec.</strong> ' +
      "Check the console for details.</p>";
  };

  global.JumpCloudDocs = JumpCloudDocs;
})(typeof window !== "undefined" ? window : global);
