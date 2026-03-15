/**
 * custom.js — Enterprise AI Chat UI runtime customisations
 *
 * What this file does:
 *  1. Fetches /public/app_info.json (written by entrypoint.sh with real env values).
 *  2. Hides the built-in README button in the Chainlit header (CSS handles most
 *     cases; this covers any that slip through via aria-label matching).
 *  3. Watches for the profile dropdown to open (MutationObserver) and injects
 *     a "Help" menu item directly above the Logout item.
 *  4. Clicking Help opens a modal showing version, environment, and usage tips.
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 1. Load runtime info written by the container entrypoint
   * ------------------------------------------------------------------ */
  let APP = { version: "—", environment: "—", buildDate: "" };

  fetch("/public/app_info.json")
    .then(function (r) { return r.json(); })
    .then(function (data) { APP = data; })
    .catch(function () { /* use defaults */ });

  /* ------------------------------------------------------------------
   * 2. Help modal
   * ------------------------------------------------------------------ */
  function envBadgeClass(env) {
    if (!env) return "cl-badge-dev";
    var e = env.toLowerCase();
    if (e === "production" || e === "prod") return "cl-badge-prod";
    if (e === "staging")                    return "cl-badge-staging";
    return "cl-badge-dev";
  }

  function showHelpModal() {
    if (document.getElementById("cl-help-overlay")) return; // already open

    var dateHtml = APP.buildDate
      ? '<span class="cl-badge cl-badge-date">Built ' + APP.buildDate + "</span>"
      : "";

    var overlay = document.createElement("div");
    overlay.id = "cl-help-overlay";
    overlay.innerHTML =
      '<div id="cl-help-card">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          "<h2>Enterprise AI Assistant</h2>" +
          '<button id="cl-help-close" aria-label="Close help">&#x2715;</button>' +
        "</div>" +
        '<p class="cl-help-subtitle">Internal AI platform — LangGraph · LiteLLM · MCP</p>' +
        '<div class="cl-help-badges">' +
          '<span class="cl-badge cl-badge-version">v' + APP.version + "</span>" +
          '<span class="cl-badge ' + envBadgeClass(APP.environment) + '">' +
            APP.environment +
          "</span>" +
          dateHtml +
        "</div>" +
        "<hr>" +
        '<p style="margin:0 0 8px;font-size:13px;font-weight:600">How to use</p>' +
        "<ul>" +
          "<li>Type a question to query enterprise data</li>" +
          "<li>Expand ▶ tool steps to inspect SQL queries and OPA policy results</li>" +
          "<li>Browse past conversations in the History sidebar on the left</li>" +
          "<li>Click any past conversation to resume it</li>" +
        "</ul>" +
        "<hr>" +
        '<p class="cl-help-footer">Contact the platform team for access issues or to report a problem.</p>' +
      "</div>";

    /* Close on overlay click or × button */
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector("#cl-help-close").addEventListener("click", function () {
      overlay.remove();
    });
    /* Close on Escape */
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); }
    });

    document.body.appendChild(overlay);
  }

  /* ------------------------------------------------------------------
   * 3. Inject "Help" item into the profile dropdown above Logout
   * ------------------------------------------------------------------ */
  function buildHelpMenuItem(referenceItem) {
    /* Clone the Logout item so the Help item inherits all MUI styling */
    var item = referenceItem.cloneNode(true);
    item.removeAttribute("data-cl-help-item"); // avoid duplication guard on clone
    item.setAttribute("data-cl-help-item", "true");

    /* Replace every text node that says "Logout" / "Sign out" with "Help" */
    var walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var t = node.nodeValue.trim().toLowerCase();
      if (t === "logout" || t === "log out" || t === "sign out") {
        node.nodeValue = node.nodeValue.replace(/logout|log out|sign out/i, "Help");
      }
    }

    /* Swap any SVG icon for a simple question-mark circle */
    var svg = item.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.innerHTML =
        '<circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 17v.5M12 7a2.5 2.5 0 0 1 2.5 2.5c0 1.5-2.5 2.5-2.5 3.5"/>';
    }

    item.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      /* Close the dropdown by simulating a click outside it */
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      showHelpModal();
    });

    return item;
  }

  function tryInjectHelpItem(root) {
    /* Guard: only process nodes that contain menu items */
    var items = root.querySelectorAll('[role="menuitem"]');
    if (!items.length) return;

    items.forEach(function (item) {
      /* Skip items we already injected */
      if (item.getAttribute("data-cl-help-item")) return;

      var text = item.textContent.trim().toLowerCase();
      if (text === "logout" || text === "log out" || text === "sign out") {
        /* Make sure we haven't already added Help before this Logout */
        var prev = item.previousElementSibling;
        if (prev && prev.getAttribute("data-cl-help-item")) return;

        var helpItem = buildHelpMenuItem(item);
        item.parentNode.insertBefore(helpItem, item);
      }
    });
  }

  /* ------------------------------------------------------------------
   * 4. Hide the built-in README button (JS fallback after CSS)
   * ------------------------------------------------------------------ */
  function hideReadmeButton(root) {
    (root || document).querySelectorAll("button").forEach(function (btn) {
      var label = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (label.includes("readme")) btn.style.display = "none";
    });
  }

  /* ------------------------------------------------------------------
   * 5. MutationObserver — run checks whenever the DOM changes
   * ------------------------------------------------------------------ */
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return; // element nodes only
        tryInjectHelpItem(node);
        hideReadmeButton(node);
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  /* Initial pass in case elements are already in the DOM */
  hideReadmeButton(document);

})();
