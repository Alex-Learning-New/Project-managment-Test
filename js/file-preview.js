"use strict";

import { signedUrl } from "./storage.js";

/* ============================================================
   file-preview.js — how stored files are shown and opened.

   • fileGroupHtml(files)  → the list of file rows used in task
     details and worksheet details. Each row shows an icon, the
     name, WHO uploaded it (Admin / Project Manager / Employee
     badge), when, the size, and a Download button.
   • Clicking a row opens a full-window preview (like Google
     Drive): images, PDFs, video, audio and text files display
     right inside the page, with prev / next through the files in
     the same list, and a Download button. Other types (Word,
     Excel, PowerPoint, zip…) show a download prompt instead.

   Importing this module is enough to switch the click handling
   on for the whole page.
   ============================================================ */

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "m4a", "aac"];
const TEXT_EXT = ["txt", "md", "csv", "json", "log", "xml", "yml", "yaml", "js", "css", "html"];
const TEXT_PREVIEW_LIMIT = 200000; // characters

const ROLES = {
    admin: { label: "Admin", cls: "fp-role-admin", accent: "fp-accent-admin" },
    "project-manager": { label: "Project Manager", cls: "fp-role-pm", accent: "fp-accent-pm" },
    employee: { label: "Employee", cls: "fp-role-emp", accent: "fp-accent-emp" },
};

/* ---------- small helpers ---------- */
const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

function extOf(name) {
    const parts = String(name || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function kindOf(f) {
    const ext = extOf(f.name);
    const t = f.type || "";
    if (t.startsWith("image/") || IMAGE_EXT.includes(ext)) return "image";
    if (t === "application/pdf" || ext === "pdf") return "pdf";
    if (t.startsWith("video/") || VIDEO_EXT.includes(ext)) return "video";
    if (t.startsWith("audio/") || AUDIO_EXT.includes(ext)) return "audio";
    if (t.startsWith("text/") || TEXT_EXT.includes(ext)) return "text";
    return "other";
}

function iconFor(f) {
    const ext = extOf(f.name);
    const kind = kindOf(f);
    if (kind === "image") return "🖼️";
    if (kind === "pdf") return "📕";
    if (kind === "video") return "🎞️";
    if (kind === "audio") return "🎵";
    if (["doc", "docx"].includes(ext)) return "📝";
    if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
    if (["ppt", "pptx"].includes(ext)) return "📽️";
    if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "🗜️";
    if (kind === "text") return "📄";
    return "📎";
}

function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtWhen(f) {
    if (f.uploadedAt) {
        return new Date(f.uploadedAt).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    if (f.date) {
        const d = new Date(f.date + "T00:00:00");
        if (!isNaN(d)) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }
    return "";
}

function uploaderHtml(f) {
    const by = f.uploadedBy;
    if (!by) return `<span class="fp-unknown">Uploader unknown</span>`;
    const role = ROLES[by.role];
    return `${role ? `<span class="fp-role ${role.cls}">${role.label}</span>` : ""}<span>${esc(by.name || "")}</span>`;
}

/* ---------- file rows (used in task + worksheet details) ---------- */
export function fileItemHtml(f) {
    const role = f.uploadedBy ? ROLES[f.uploadedBy.role] : null;
    const canOpen = !!f.path;
    const meta = [fmtWhen(f), fmtSize(f.size)].filter(Boolean).join(" · ");
    const data = esc(JSON.stringify(f));

    const main = `
      <span class="fp-icon">${iconFor(f)}</span>
      <div class="fp-info">
        <span class="fp-name">${esc(f.name)}</span>
        <div class="fp-sub">${uploaderHtml(f)}${meta ? `<span class="fp-dot">·</span><span>${esc(meta)}</span>` : ""}</div>
      </div>`;

    return `<div class="fp-item ${role ? role.accent : ""}">
      ${
          canOpen
              ? `<div class="fp-main" data-file="${data}" role="button" tabindex="0" title="Preview">${main}</div>
                 <button type="button" class="btn btn-sm btn-ghost fp-dl" data-file-download="${data}" title="Download">⬇ Download</button>`
              : `<div class="fp-main fp-static">${main}</div>`
      }
    </div>`;
}

export function fileGroupHtml(files) {
    return `<div class="fp-group" data-file-group>${files.map(fileItemHtml).join("")}</div>`;
}

/* ---------- download ---------- */
function flash(message) {
    const el = document.createElement("div");
    el.className = "fp-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

async function download(f) {
    try {
        const url = await signedUrl(f, 60, { download: f.name || true });
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name || "";
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        flash(e.message);
    }
}

/* ---------- preview overlay ---------- */
let overlay = null;
let stage = null;
let list = [];
let idx = 0;
let token = 0;
let blobUrl = null;

function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "fp-overlay hidden";
    overlay.innerHTML = `
      <div class="fp-head">
        <div class="fp-title">
          <span class="fp-icon" data-fp="icon"></span>
          <div class="fp-title-text">
            <b data-fp="name"></b>
            <div class="fp-sub fp-sub-dark" data-fp="meta"></div>
          </div>
        </div>
        <div class="fp-actions">
          <button type="button" class="fp-nav" data-fp="prev" title="Previous (←)">‹</button>
          <span class="fp-count" data-fp="count"></span>
          <button type="button" class="fp-nav" data-fp="next" title="Next (→)">›</button>
          <button type="button" class="btn btn-lime btn-sm" data-fp="download">⬇ Download</button>
          <button type="button" class="fp-close" data-fp="close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="fp-stage" data-fp="stage"></div>`;
    document.body.appendChild(overlay);

    const q = (k) => overlay.querySelector(`[data-fp="${k}"]`);
    stage = q("stage");

    q("close").addEventListener("click", closePreview);
    q("prev").addEventListener("click", () => step(-1));
    q("next").addEventListener("click", () => step(1));
    q("download").addEventListener("click", () => download(list[idx]));
    stage.addEventListener("click", (e) => {
        if (e.target === stage) closePreview();
    });
}

function releaseBlob() {
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
    }
}

function isOpen() {
    return overlay && !overlay.classList.contains("hidden");
}

function closePreview() {
    if (!overlay) return;
    token++;
    releaseBlob();
    stage.innerHTML = ""; // also stops any playing video / audio
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
}

function step(delta) {
    const next = idx + delta;
    if (next < 0 || next >= list.length) return;
    show(next);
}

function unsupported(f, message) {
    const ext = extOf(f.name);
    stage.innerHTML = `<div class="fp-unsupported">
      <div class="fp-big-icon">${iconFor(f)}</div>
      <h3>${esc(f.name)}</h3>
      <p>${esc(message || `No in-window preview for ${ext ? "." + ext : "this type of"} files.`)}</p>
      <button type="button" class="btn btn-lime" data-fp-inline-download>⬇ Download</button>
    </div>`;
    stage
        .querySelector("[data-fp-inline-download]")
        .addEventListener("click", () => download(f));
}

async function fetchResponse(f) {
    const url = await signedUrl(f);
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't load this file.");
    return res;
}

async function show(i) {
    idx = i;
    const f = list[i];
    const mine = ++token;
    releaseBlob();

    const q = (k) => overlay.querySelector(`[data-fp="${k}"]`);
    q("icon").textContent = iconFor(f);
    q("name").textContent = f.name;
    q("meta").innerHTML =
        uploaderHtml(f) +
        [fmtWhen(f), fmtSize(f.size)]
            .filter(Boolean)
            .map((t) => `<span class="fp-dot">·</span><span>${esc(t)}</span>`)
            .join("");
    q("count").textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
    q("prev").classList.toggle("hidden", list.length < 2);
    q("next").classList.toggle("hidden", list.length < 2);
    q("prev").disabled = i === 0;
    q("next").disabled = i === list.length - 1;

    stage.innerHTML = `<div class="fp-loading"><div class="fp-spinner"></div>Loading preview…</div>`;

    const kind = kindOf(f);

    try {
        if (kind === "image") {
            const url = await signedUrl(f);
            if (mine !== token) return;
            const img = new Image();
            img.className = "fp-img";
            img.alt = f.name;
            img.onerror = () => mine === token && unsupported(f, "This image couldn't be displayed.");
            img.onload = () => {
                if (mine === token) {
                    stage.innerHTML = "";
                    stage.appendChild(img);
                }
            };
            img.src = url;
        } else if (kind === "video" || kind === "audio") {
            const url = await signedUrl(f);
            if (mine !== token) return;
            const el = document.createElement(kind);
            el.className = kind === "video" ? "fp-video" : "fp-audio";
            el.controls = true;
            el.src = url;
            el.onerror = () => mine === token && unsupported(f, "This file couldn't be played in the browser.");
            stage.innerHTML = "";
            stage.appendChild(el);
        } else if (kind === "pdf") {
            const res = await fetchResponse(f);
            const buf = await res.arrayBuffer();
            if (mine !== token) return;
            blobUrl = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
            const frame = document.createElement("iframe");
            frame.className = "fp-frame";
            frame.title = f.name;
            frame.src = blobUrl;
            stage.innerHTML = "";
            stage.appendChild(frame);
        } else if (kind === "text") {
            const res = await fetchResponse(f);
            let text = await res.text();
            if (mine !== token) return;
            const truncated = text.length > TEXT_PREVIEW_LIMIT;
            if (truncated) text = text.slice(0, TEXT_PREVIEW_LIMIT);
            const pre = document.createElement("pre");
            pre.className = "fp-text";
            pre.textContent = text + (truncated ? "\n\n… preview truncated — download for the full file." : "");
            stage.innerHTML = "";
            stage.appendChild(pre);
        } else {
            unsupported(f);
        }
    } catch (e) {
        if (mine === token) unsupported(f, e.message);
    }
}

function openFrom(el) {
    const group = el.closest("[data-file-group]");
    const nodes = group ? [...group.querySelectorAll(".fp-main[data-file]")] : [el];

    list = nodes.map((n) => JSON.parse(n.dataset.file));
    idx = Math.max(0, nodes.indexOf(el));

    ensureOverlay();
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    show(idx);
}

/* ---------- global wiring ---------- */
document.addEventListener("click", (e) => {
    const dl = e.target.closest("[data-file-download]");
    if (dl) {
        e.preventDefault();
        download(JSON.parse(dl.dataset.fileDownload));
        return;
    }

    const main = e.target.closest(".fp-main[data-file]");
    if (main) {
        e.preventDefault();
        openFrom(main);
    }
});

document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".fp-main[data-file]")) {
        e.preventDefault();
        openFrom(e.target);
    }
});

// Capture phase on window: while the preview is open, Esc closes ONLY the
// preview (not the task popup underneath) and the arrows flip through files.
window.addEventListener(
    "keydown",
    (e) => {
        if (!isOpen()) return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closePreview();
        } else if (e.key === "ArrowLeft") {
            step(-1);
        } else if (e.key === "ArrowRight") {
            step(1);
        }
    },
    true,
);
