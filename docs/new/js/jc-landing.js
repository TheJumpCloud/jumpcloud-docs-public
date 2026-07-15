/**
 * JumpCloud /new UX spike — Scalar landing viewer (sources[]).
 * Expects window.LANDING_SOURCES, window.LANDING_SOURCES_META, window.__JC_SCALAR_CREATE_OPTS.
 */
(function (global) {
  "use strict";

  var JumpCloudDocs = global.JumpCloudDocs || {};
  var STORAGE_KEY = "jumpcloudDocsRegion";
  var REGION_SERVER_KEY = "x-jc-region";

  var specCache = Object.create(null);
  var mountGeneration = 0;
  var activeSlug = null;
  var currentRegionKey = null;
  var currentRegionSwitcher = null;

  function sources() {
    return Array.isArray(global.LANDING_SOURCES)
      ? global.LANDING_SOURCES
      : [];
  }

  function metaBySlug() {
    var map = Object.create(null);
    var metaList = Array.isArray(global.LANDING_SOURCES_META)
      ? global.LANDING_SOURCES_META
      : [];
    metaList.forEach(function (entry) {
      if (entry && entry.slug) {
        map[entry.slug] = entry;
      }
    });
    return map;
  }

  function sourceBySlug(slug) {
    return sources().find(function (entry) {
      return entry.slug === slug;
    });
  }

  function slugFromHash() {
    var hash = (global.location.hash || "").replace(/^#/, "");
    if (!hash) {
      return "";
    }
    var slug = hash.split("/")[0];
    return sourceBySlug(slug) ? slug : "";
  }

  function defaultSlugFromQuery() {
    var fromHash = slugFromHash();
    if (fromHash) {
      return fromHash;
    }
    var params = new URLSearchParams(global.location.search);
    var doc = (params.get("doc") || "").trim();
    if (doc && sourceBySlug(doc)) {
      return doc;
    }
    var def = sources().find(function (entry) {
      return entry.default;
    });
    return def ? def.slug : sources()[0] ? sources()[0].slug : "";
  }

  function syncLandingUrl(slug) {
    if (!slug || !sourceBySlug(slug)) {
      return;
    }
    var path = global.location.pathname;
    var rawHash = (global.location.hash || "").replace(/^#/, "");
    var hash;
    if (!rawHash) {
      hash = "#" + slug;
    } else {
      var parts = rawHash.split("/");
      parts[0] = slug;
      hash = "#" + parts.join("/");
    }
    global.history.replaceState(null, document.title, path + hash);
  }

  function handleLandingNavigation(slug) {
    if (!slug || slug === activeSlug) {
      return;
    }
    activeSlug = slug;
    syncLandingUrl(slug);
    updateHeaderControls();
  }

  function cloneSpec(spec) {
    return JSON.parse(JSON.stringify(spec));
  }

  function savedRegionKey(switcher) {
    if (!switcher || !Array.isArray(switcher.regions) || !switcher.regions.length) {
      return "";
    }
    var regionKeys = switcher.regions.map(function (region) {
      return region.key;
    });
    var configuredDefault = String(switcher.default_region || "").toLowerCase();
    var fallback =
      regionKeys.indexOf(configuredDefault) !== -1 ? configuredDefault : regionKeys[0];
    try {
      var stored = String(global.localStorage.getItem(STORAGE_KEY) || "").toLowerCase();
      return regionKeys.indexOf(stored) !== -1 ? stored : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function persistRegionKey(key) {
    try {
      global.localStorage.setItem(STORAGE_KEY, key);
    } catch (err) {
      /* ignore */
    }
  }

  function hostAliasesFromSwitcher(switcher) {
    if (!switcher || !Array.isArray(switcher.regions)) {
      return [];
    }
    return switcher.regions
      .map(function (region) {
        return String(region.host || "").toLowerCase();
      })
      .filter(Boolean);
  }

  function normalizeRegionHostStrings(value, targetHost, hostAliases) {
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

  function walkMutateStrings(node, targetHost, hostAliases) {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (var idx = 0; idx < node.length; idx++) {
        if (typeof node[idx] === "string") {
          node[idx] = normalizeRegionHostStrings(node[idx], targetHost, hostAliases);
        } else {
          walkMutateStrings(node[idx], targetHost, hostAliases);
        }
      }
      return;
    }
    var keys = Object.keys(node);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === "servers") {
        continue;
      }
      var value = node[key];
      if (typeof value === "string") {
        node[key] = normalizeRegionHostStrings(value, targetHost, hostAliases);
      } else {
        walkMutateStrings(value, targetHost, hostAliases);
      }
    }
  }

  function applyRegionToSpec(spec, switcher, regionKey) {
    if (!switcher || !Array.isArray(switcher.regions) || switcher.regions.length < 2) {
      return;
    }
    var hostByRegion = Object.fromEntries(
      switcher.regions.map(function (region) {
        return [region.key, region.host];
      }),
    );
    var hostAliases = hostAliasesFromSwitcher(switcher);
    var targetHost = hostByRegion[regionKey] || hostByRegion[switcher.regions[0].key];
    walkMutateStrings(spec, targetHost, hostAliases);

    if (spec.servers && Array.isArray(spec.servers)) {
      var matchIdx = spec.servers.findIndex(function (server) {
        if (!server || typeof server !== "object") {
          return false;
        }
        return String(server[REGION_SERVER_KEY] || "").toLowerCase() === regionKey;
      });
      if (matchIdx > 0) {
        var selected = spec.servers.splice(matchIdx, 1)[0];
        spec.servers.unshift(selected);
      }
    }
  }

  async function fetchRawSpec(sourceDef) {
    if (specCache[sourceDef.slug]) {
      return cloneSpec(specCache[sourceDef.slug]);
    }
    var response = await fetch(sourceDef.url);
    if (!response.ok) {
      throw new Error("Spec HTTP " + response.status + " for " + sourceDef.url);
    }
    var spec = JumpCloudDocs.parseSpecDocument(await response.text());
    specCache[sourceDef.slug] = spec;
    return cloneSpec(spec);
  }

  function prepareSpec(sourceDef, regionKey) {
    return fetchRawSpec(sourceDef).then(function (raw) {
      var meta = metaBySlug()[sourceDef.slug] || {};
      var switcher = meta.region_switcher || null;
      if (switcher && regionKey) {
        applyRegionToSpec(raw, switcher, regionKey);
      }
      return JumpCloudDocs.prepareScalarSpec(raw);
    });
  }

  function syncViewportHeight() {
    if (JumpCloudDocs.syncScalarViewportHeight) {
      JumpCloudDocs.syncScalarViewportHeight();
    }
  }

  function detectActiveSlugFromDom() {
    var active = document.querySelector(".references-navigation-list-item.active");
    if (active && active.textContent) {
      var title = active.textContent.trim();
      var match = sources().find(function (entry) {
        return entry.title === title;
      });
      if (match) {
        return match.slug;
      }
    }
    return activeSlug;
  }

  function buildRegionMenuHtml(switcher) {
    if (!switcher || !Array.isArray(switcher.regions)) {
      return "";
    }
    return switcher.regions
      .map(function (region) {
        return (
          '<button type="button" class="jc-region-item' +
          (region.key === currentRegionKey ? " is-active" : "") +
          '" data-region="' +
          region.key +
          '">' +
          region.label +
          "</button>"
        );
      })
      .join("");
  }

  function bindRegionMenu(switcher) {
    var button = document.getElementById("jcRegionButton");
    var menu = document.getElementById("jcRegionMenu");
    var labelEl = document.getElementById("jcRegionLabel");
    if (!button || !menu) {
      return;
    }
    menu.innerHTML = buildRegionMenuHtml(switcher);
    if (labelEl) {
      var active =
        switcher.regions.find(function (region) {
          return region.key === currentRegionKey;
        }) || switcher.regions[0];
      labelEl.textContent = active.label || active.key || "—";
    }

    button.onclick = function (event) {
      event.stopPropagation();
      var open = !menu.classList.contains("is-open");
      menu.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    };

    menu.querySelectorAll(".jc-region-item").forEach(function (item) {
      item.onclick = function (event) {
        event.stopPropagation();
        var key = item.getAttribute("data-region");
        menu.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
        if (key && key !== currentRegionKey) {
          currentRegionKey = key;
          persistRegionKey(key);
          specCache = Object.create(null);
          remountLanding(activeSlug || defaultSlugFromQuery());
        }
      };
    });
  }

  function navBarTitle(sourceTitle) {
    var title = String(sourceTitle || "").trim();
    if (!title) {
      return "";
    }
    if (title.endsWith(" Reference")) {
      return title;
    }
    return title + " Reference";
  }

  function refreshLandingChrome() {
    activeSlug = detectActiveSlugFromDom() || activeSlug;
    updateHeaderControls();
    syncViewportHeight();
  }

  async function updateHeaderControls() {
    var titleEl = document.getElementById("jcActiveApi");
    var regionWrap = document.getElementById("jcRegionWrap");
    var slug = activeSlug || defaultSlugFromQuery();
    var source = sourceBySlug(slug);
    var meta = metaBySlug()[slug] || {};

    if (titleEl && source) {
      titleEl.textContent = navBarTitle(source.title);
    }

    if (!regionWrap) {
      return;
    }

    if (meta.region_switcher) {
      regionWrap.classList.remove("is-hidden");
      bindRegionMenu(meta.region_switcher);
      return;
    }

    regionWrap.classList.add("is-hidden");
  }

  async function buildSourcesPayload(preferredSlug) {
    var payloads = [];
    var regionKey = currentRegionKey;
    for (var i = 0; i < sources().length; i++) {
      var sourceDef = sources()[i];
      var meta = metaBySlug()[sourceDef.slug] || {};
      var switcher = meta.region_switcher || null;
      var slugRegionKey = switcher ? regionKey : null;
      var prepared = await prepareSpec(sourceDef, slugRegionKey);
      payloads.push({
        title: sourceDef.title,
        slug: sourceDef.slug,
        default: sourceDef.slug === (preferredSlug || defaultSlugFromQuery()),
        content: JSON.stringify(prepared),
      });
    }
    if (!payloads.some(function (entry) {
      return entry.default;
    }) && payloads.length) {
      payloads[0].default = true;
    }
    return payloads;
  }

  function scalarCreateOptions(sourcePayloads) {
    var base = Object.assign({}, global.__JC_SCALAR_CREATE_OPTS || {});
    base.sources = sourcePayloads;
    base.onDocumentSelect = function () {
      global.requestAnimationFrame(refreshLandingChrome);
    };
    base.onLoaded = function (slug) {
      if (slug) {
        handleLandingNavigation(slug);
      }
      global.requestAnimationFrame(refreshLandingChrome);
    };
    return base;
  }

  async function remountLanding(preferredSlug) {
    var generation = ++mountGeneration;
    var host = document.getElementById("jc-scalar-root");
    if (!host || !global.Scalar) {
      return;
    }
    host.innerHTML = "";
    var payloads;
    try {
      payloads = await buildSourcesPayload(preferredSlug);
    } catch (err) {
      console.error(err);
      host.innerHTML =
        '<p style="padding:24px;color:#f44336">Could not load API specs. Serve docs over HTTP and check the console.</p>';
      return;
    }
    if (generation !== mountGeneration) {
      return;
    }
    activeSlug = preferredSlug || defaultSlugFromQuery();
    global.Scalar.createApiReference("#jc-scalar-root", scalarCreateOptions(payloads));
    if (JumpCloudDocs.scheduleScalarViewportSync) {
      JumpCloudDocs.scheduleScalarViewportSync();
    }
    syncLandingUrl(activeSlug);
    refreshLandingChrome();
  }

  function initLanding() {
    var initialSlug = defaultSlugFromQuery();
    var meta = metaBySlug()[initialSlug] || {};
    currentRegionSwitcher = meta.region_switcher || null;
    currentRegionKey = currentRegionSwitcher ? savedRegionKey(currentRegionSwitcher) : null;

    global.addEventListener("click", function () {
      var menu = document.getElementById("jcRegionMenu");
      var button = document.getElementById("jcRegionButton");
      if (menu) {
        menu.classList.remove("is-open");
      }
      if (button) {
        button.setAttribute("aria-expanded", "false");
      }
    });
    global.addEventListener("resize", syncViewportHeight);
    global.addEventListener("hashchange", function () {
      var slug = slugFromHash();
      if (slug) {
        handleLandingNavigation(slug);
      }
    });
    remountLanding(initialSlug);
  }

  JumpCloudDocs.initLanding = initLanding;
  global.JumpCloudDocs = JumpCloudDocs;
})(typeof window !== "undefined" ? window : global);
