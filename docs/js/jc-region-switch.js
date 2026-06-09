/**
 * Multi-region docs bootstrap for ReDoc and Scalar viewers.
 */
(function (global) {
  "use strict";

  var JumpCloudDocs = global.JumpCloudDocs || {};

  var STORAGE_KEY = "jumpcloudDocsRegion";
  var REGION_SERVER_KEY = "x-jc-region";

  function showRegionMountError(root, message) {
    root.innerHTML =
      '<p class="p-4 text-danger"><strong>Could not load API spec.</strong> ' +
      message +
      " Check the console for details.</p>";
  }

  JumpCloudDocs.initRegionSwitcher = function (config) {
    var regionSwitcher = (config && config.regionSwitcher) || {};
    var renderer = (config && config.renderer) || "redoc";
    var specUrl = config && config.specUrl;
    var regions = Array.isArray(regionSwitcher.regions) ? regionSwitcher.regions : [];
    var regionKeys = regions.map(function (region) {
      return region.key;
    });

    if (!regionKeys.length || !specUrl) {
      return;
    }

    var hostByRegion = Object.fromEntries(
      regions.map(function (region) {
        return [region.key, region.host];
      }),
    );
    var labelByRegion = Object.fromEntries(
      regions.map(function (region) {
        return [region.key, region.label];
      }),
    );
    var hostAliases = regions
      .map(function (region) {
        return String(region.host || "").toLowerCase();
      })
      .filter(Boolean);

    var mountGeneration = 0;

    function normalizeRegionHostStrings(value, targetHost) {
      if (typeof value !== "string") {
        return value;
      }
      var replaced = value;
      for (var i = 0; i < hostAliases.length; i++) {
        var host = hostAliases[i];
        if (host !== targetHost) {
          replaced = replaced.split(host).join(targetHost);
        }
      }
      return replaced;
    }

    function walkMutateStrings(node, targetHost) {
      if (node === null || typeof node !== "object") {
        return;
      }
      if (Array.isArray(node)) {
        for (var idx = 0; idx < node.length; idx++) {
          if (typeof node[idx] === "string") {
            node[idx] = normalizeRegionHostStrings(node[idx], targetHost);
          } else {
            walkMutateStrings(node[idx], targetHost);
          }
        }
        return;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var value = node[key];
        if (typeof value === "string") {
          node[key] = normalizeRegionHostStrings(value, targetHost);
        } else {
          walkMutateStrings(value, targetHost);
        }
      }
    }

    function applyRegionToSpec(spec, targetHost) {
      var servers = spec.servers;
      delete spec.servers;
      walkMutateStrings(spec, targetHost);
      if (servers) {
        spec.servers = servers;
      }
      if (typeof spec.host === "string") {
        var host = spec.host.toLowerCase();
        if (hostAliases.indexOf(host) !== -1) {
          spec.host = targetHost;
        }
      }
    }

    function reorderServersForRegion(spec, regionKey) {
      if (!spec.servers || !Array.isArray(spec.servers)) {
        return;
      }
      var key = String(regionKey || "").toLowerCase();
      if (!key) {
        return;
      }
      var matchIdx = spec.servers.findIndex(function (server) {
        if (!server || typeof server !== "object") {
          return false;
        }
        var serverRegion = String(server[REGION_SERVER_KEY] || "").toLowerCase();
        return serverRegion === key;
      });
      if (matchIdx <= 0) {
        return;
      }
      var selected = spec.servers.splice(matchIdx, 1)[0];
      spec.servers.unshift(selected);
    }

    function savedRegionKey() {
      var configuredDefault = (regionSwitcher.default_region || "").toLowerCase();
      var fallbackDefault =
        regionKeys.indexOf(configuredDefault) !== -1 ? configuredDefault : regionKeys[0] || "";
      var value = (global.localStorage.getItem(STORAGE_KEY) || fallbackDefault).toLowerCase();
      return regionKeys.indexOf(value) !== -1 ? value : fallbackDefault;
    }

    function setSavedRegionKey(key) {
      global.localStorage.setItem(STORAGE_KEY, key);
    }

    function setRegionLabel(regionKey) {
      var labelEl = document.getElementById("jcRegionLabel");
      if (!labelEl) {
        return;
      }
      labelEl.textContent =
        labelByRegion[regionKey] || labelByRegion[regionKeys[0]] || regionKey;
    }

    function restoreDocHash(savedHash) {
      if (!savedHash) {
        return;
      }
      try {
        if (global.location.hash === savedHash) {
          var base = global.location.pathname + global.location.search;
          global.history.replaceState(null, document.title, base);
        }
        global.location.hash = savedHash;
      } catch (error) {
        console.warn("JumpCloud region switcher: could not restore doc hash", error);
      }
    }

    async function mountViewer(regionKey) {
      var targetHost = hostByRegion[regionKey] || hostByRegion[regionKeys[0]];
      var currentGeneration = ++mountGeneration;
      var spec;
      try {
        var response = await fetch(specUrl);
        if (!response.ok) {
          throw new Error("Spec HTTP " + response.status);
        }
        var text = await response.text();
        if (currentGeneration !== mountGeneration) {
          return;
        }
        spec = JumpCloudDocs.parseSpecDocument(text);
      } catch (error) {
        if (currentGeneration !== mountGeneration) {
          return;
        }
        throw error;
      }
      if (currentGeneration !== mountGeneration) {
        return;
      }
      applyRegionToSpec(spec, targetHost);
      reorderServersForRegion(spec, regionKey);
      var root = document.getElementById("jc-region-spec-viewer-root");
      if (!root) {
        return;
      }

      var docHash = global.location.hash || "";
      if (renderer === "scalar" && typeof JumpCloudDocs.destroyScalarApiReference === "function") {
        JumpCloudDocs.destroyScalarApiReference();
      }
      root.innerHTML = "";

      if (renderer === "scalar") {
        var scalarHost = document.createElement("div");
        scalarHost.id = "scalar-api-reference";
        scalarHost.style.width = "100%";
        scalarHost.style.minHeight = "100%";
        root.appendChild(scalarHost);
        try {
          JumpCloudDocs.mountScalarApiReference("#scalar-api-reference", spec);
        } catch (error) {
          if (currentGeneration !== mountGeneration) {
            return;
          }
          console.error("JumpCloud region switcher: Scalar render error", error);
          showRegionMountError(root, "");
          return;
        }
        restoreDocHash(docHash);
        return;
      }

      var redocEl = document.createElement("redoc");
      root.appendChild(redocEl);
      var opts = global.__JC_REDOC_OPTS || { scrollYOffset: "nav" };
      var restoreTimer = setTimeout(function () {
        if (currentGeneration !== mountGeneration) {
          return;
        }
        restoreDocHash(docHash);
      }, 250);
      global.Redoc.init(spec, opts, redocEl, function (maybeErr) {
        clearTimeout(restoreTimer);
        if (currentGeneration !== mountGeneration) {
          return;
        }
        if (maybeErr instanceof Error) {
          console.error("JumpCloud region switcher: Redoc render error", maybeErr);
        }
        restoreDocHash(docHash);
      });
    }

    function wireRegionMenu() {
      var menuItems = document.querySelectorAll(".jc-region-item");
      for (var idx = 0; idx < menuItems.length; idx++) {
        menuItems[idx].addEventListener("click", async function (event) {
          event.preventDefault();
          var key = this.getAttribute("data-jc-region");
          if (!key) {
            return;
          }
          setSavedRegionKey(key);
          setRegionLabel(key);
          try {
            await mountViewer(key);
          } catch (error) {
            console.error("JumpCloud region switcher: remount failed", error);
          }
        });
      }
    }

    wireRegionMenu();
    var initialRegionKey = savedRegionKey();
    setRegionLabel(initialRegionKey);
    void (async function bootInitialMount() {
      try {
        await mountViewer(initialRegionKey);
      } catch (error) {
        console.error("JumpCloud region switcher: initial mount failed", error);
        var root = document.getElementById("jc-region-spec-viewer-root");
        if (root) {
          showRegionMountError(root, "");
        }
      }
    })();
  };

  global.JumpCloudDocs = JumpCloudDocs;
})(typeof window !== "undefined" ? window : global);
