"use strict";

import { supabase } from "./supabase.js";
import { state } from "./state.js";
import { loadData } from "./data.js";
import {
     currentUser,
     escapeHtml,
     initials,
     colorFor,
     toast,
     confirmDialog,
     refreshSidebarUser,
} from "./common.js";

/* ============================================================
    profile.js — the "My profile" page (admin, project manager, employee)
    Opened from the name / role / avatar at the bottom of the sidebar.

      • profile photo: upload → crop / zoom / rotate → save, or remove
      • personal details: name, email, phone (editable) and
        ID, role, department, teams (read-only)
      • change password

    Storage : public Supabase bucket `avatars`, one file per upload:
              avatars/<userId>/<timestamp>.jpg   (URL kept in `avatar_url`)
    Tables  : `users` for admin + employee, `project_managers` for PMs.
              Needs the columns  email, phone, avatar_url  on both.
   ============================================================ */

const AVATAR_BUCKET = "avatars";
const MAX_PHOTO_MB = 8;
const OUTPUT_PX = 512; // saved photo is a 512 × 512 square
const MAX_ZOOM = 4;

const ROLE_LABELS = {
     admin: "Admin",
     employee: "Employee",
     "project-manager": "Project Manager",
};

const ID_LABELS = {
     admin: "Admin ID",
     employee: "Employee ID",
     "project-manager": "Manager ID",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const $ = (id) => document.getElementById(id);
const tableFor = (u) => (u.role === "project-manager" ? "project_managers" : "users");

function photoPathFromUrl(url) {
     const parts = String(url || "").split(`/${AVATAR_BUCKET}/`);
     if (parts.length < 2) return null;
     return decodeURIComponent(parts.pop().split("?")[0]);
}

function teamsOf(u) {
     if (!Array.isArray(u.teamId)) return [];
     return state.teams.filter((t) => u.teamId.includes(t.id));
}

/* ============================================================
   RENDER
   ============================================================ */
export function mountProfile() {
     const u = currentUser();
     const el = $("profile-content");
     if (!u || !el) return;

     const teams = teamsOf(u);
     const showDept = u.role !== "project-manager" || u.department;

     el.innerHTML = `
    <div class="profile-page">
      <div class="profile-grid">

        <!-- photo card -->
        <div class="panel profile-photo-card">
          <div class="profile-photo-body">
            <div class="profile-avatar" style="background:${colorFor(u.id)}">
              ${u.avatar_url ? `<img src="${escapeHtml(u.avatar_url)}" alt="Profile photo" />` : escapeHtml(initials(u.name))}
            </div>
            <h3>${escapeHtml(u.name)}</h3>
            <span class="badge badge-review">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span>

            <div class="profile-photo-actions">
              <button type="button" class="btn btn-lime btn-sm" id="pf-upload">
                ${u.avatar_url ? "Change photo" : "Upload photo"}
              </button>
              ${u.avatar_url ? `<button type="button" class="btn btn-danger btn-sm" id="pf-remove">Remove</button>` : ""}
            </div>
            <input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
            <p class="hint">JPG, PNG or WebP, up to ${MAX_PHOTO_MB} MB. You can move, zoom and rotate it before saving.</p>
          </div>
        </div>

        <div class="profile-main">

          <!-- details -->
          <div class="panel">
            <div class="panel-head"><h3>Personal details</h3></div>
            <div class="profile-form">
              <div class="row-2">
                <div class="field">
                  <label for="pf-name">Full name</label>
                  <input id="pf-name" type="text" value="${escapeHtml(u.name)}" autocomplete="name" maxlength="80" />
                </div>
                <div class="field">
                  <label for="pf-id">${escapeHtml(ID_LABELS[u.role] || "ID")}</label>
                  <input id="pf-id" type="text" class="profile-readonly" value="${escapeHtml(u.id)}" readonly />
                </div>
              </div>

              <div class="row-2">
                <div class="field">
                  <label for="pf-email">Email</label>
                  <input id="pf-email" type="email" value="${escapeHtml(u.email || "")}" placeholder="name@company.com" autocomplete="email" />
                </div>
                <div class="field">
                  <label for="pf-phone">Phone</label>
                  <input id="pf-phone" type="tel" value="${escapeHtml(u.phone || "")}" placeholder="+91 98765 43210" autocomplete="tel" />
                </div>
              </div>

              <div class="row-2">
                <div class="field">
                  <label for="pf-role">Role</label>
                  <input id="pf-role" type="text" class="profile-readonly" value="${escapeHtml(ROLE_LABELS[u.role] || u.role)}" readonly />
                </div>
                ${showDept
               ? `<div class="field">
                  <label for="pf-dept">Department</label>
                  <input id="pf-dept" type="text" class="profile-readonly" value="${escapeHtml(u.department || "—")}" readonly />
                </div>`
               : ""}
              </div>

              ${teams.length
               ? `<div class="field">
                  <label>Teams</label>
                  <div class="team-members">
                    ${teams.map((t) => `<span class="member-chip">${escapeHtml(t.name)}</span>`).join("")}
                  </div>
                </div>`
               : ""}

              <p class="error-text" id="pf-error"></p>
              <div class="profile-actions">
                <button type="button" class="btn btn-ghost" id="pf-reset" disabled>Discard changes</button>
                <button type="button" class="btn btn-lime" id="pf-save" disabled>Save changes</button>
              </div>
            </div>
          </div>

          <!-- password -->
          <div class="panel">
            <div class="panel-head"><h3>Change password</h3></div>
            <div class="profile-form">
              <div class="field">
                <label for="pf-cur">Current password</label>
                <input id="pf-cur" type="password" autocomplete="current-password" />
              </div>
              <div class="row-2">
                <div class="field">
                  <label for="pf-new">New password</label>
                  <input id="pf-new" type="password" autocomplete="new-password" />
                  <span class="hint">At least 6 characters.</span>
                </div>
                <div class="field">
                  <label for="pf-confirm">Confirm new password</label>
                  <input id="pf-confirm" type="password" autocomplete="new-password" />
                </div>
              </div>
              <p class="error-text" id="pf-pw-error"></p>
              <div class="profile-actions">
                <button type="button" class="btn btn-lime" id="pf-pw-save">Update password</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>`;

     bindDetails(u);
     bindPassword(u);
     bindPhoto(u);
}

/* ============================================================
   DETAILS FORM
   ============================================================ */
function bindDetails(u) {
     const fields = { name: $("pf-name"), email: $("pf-email"), phone: $("pf-phone") };
     const original = {
          name: u.name || "",
          email: u.email || "",
          phone: u.phone || "",
     };
     const saveBtn = $("pf-save");
     const resetBtn = $("pf-reset");
     const errEl = $("pf-error");

     const values = () => ({
          name: fields.name.value.trim(),
          email: fields.email.value.trim(),
          phone: fields.phone.value.trim(),
     });
     const dirty = () => {
          const v = values();
          return Object.keys(original).some((k) => v[k] !== original[k]);
     };
     const sync = () => {
          const d = dirty();
          saveBtn.disabled = !d;
          resetBtn.disabled = !d;
     };

     Object.values(fields).forEach((f) => f.addEventListener("input", sync));

     resetBtn.addEventListener("click", () => {
          fields.name.value = original.name;
          fields.email.value = original.email;
          fields.phone.value = original.phone;
          errEl.textContent = "";
          sync();
     });

     saveBtn.addEventListener("click", async () => {
          const v = values();
          errEl.textContent = "";
          if (!v.name) return (errEl.textContent = "Please enter your name.");
          if (v.email && !EMAIL_RE.test(v.email))
               return (errEl.textContent = "That email address doesn't look right.");
          if (v.phone && !/^[+\d][\d\s\-()]{5,}$/.test(v.phone))
               return (errEl.textContent = "That phone number doesn't look right.");

          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";

          const { error } = await supabase
               .from(tableFor(u))
               .update({ name: v.name, email: v.email || null, phone: v.phone || null })
               .eq("id", u.id);

          saveBtn.textContent = "Save changes";

          if (error) {
               errEl.textContent = error.message;
               toast(`Couldn't save your profile: ${error.message}`, "error");
               sync();
               return;
          }

          await loadData();
          refreshSidebarUser();
          mountProfile();
          toast("Profile updated.", "success");
     });
}

/* ============================================================
   PASSWORD
   ============================================================ */
function bindPassword(u) {
     const btn = $("pf-pw-save");
     const errEl = $("pf-pw-error");

     btn.addEventListener("click", async () => {
          const cur = $("pf-cur").value;
          const next = $("pf-new").value;
          const confirm = $("pf-confirm").value;
          errEl.textContent = "";

          if (!cur) return (errEl.textContent = "Enter your current password.");
          if (next.length < 6) return (errEl.textContent = "New password must be at least 6 characters.");
          if (next !== confirm) return (errEl.textContent = "The new passwords don't match.");
          if (next === cur) return (errEl.textContent = "Choose a password different from the current one.");

          btn.disabled = true;
          btn.textContent = "Updating…";
          const done = () => {
               btn.disabled = false;
               btn.textContent = "Update password";
          };

          const { data: ok, error: checkErr } = await supabase
               .from(tableFor(u))
               .select("id")
               .eq("id", u.id)
               .eq("password", cur)
               .maybeSingle();

          if (checkErr || !ok) {
               errEl.textContent = "Current password is incorrect.";
               return done();
          }

          const { error } = await supabase
               .from(tableFor(u))
               .update({ password: next })
               .eq("id", u.id);

          done();
          if (error) {
               errEl.textContent = error.message;
               return;
          }

          ["pf-cur", "pf-new", "pf-confirm"].forEach((id) => ($(id).value = ""));
          toast("Password updated.", "success");
     });
}

/* ============================================================
   PHOTO: pick → crop → upload / remove
   ============================================================ */
function bindPhoto(u) {
     const fileInput = $("pf-file");

     $("pf-upload").addEventListener("click", () => fileInput.click());

     fileInput.addEventListener("change", async () => {
          const file = fileInput.files[0];
          fileInput.value = ""; // allows picking the same file again
          if (!file) return;

          if (!file.type.startsWith("image/")) {
               return toast("Please choose an image file.", "error");
          }
          if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
               return toast(`That photo is larger than ${MAX_PHOTO_MB} MB.`, "error");
          }

          const blob = await openCropper(file);
          if (blob) await savePhoto(u, blob);
     });

     $("pf-remove")?.addEventListener("click", () => removePhoto(u));
}

async function savePhoto(u, blob) {
     const uploadBtn = $("pf-upload");
     if (uploadBtn) {
          uploadBtn.disabled = true;
          uploadBtn.textContent = "Saving…";
     }

     const safeId = String(u.id).replace(/[^\w.-]+/g, "_");
     const path = `${safeId}/${Date.now()}.jpg`;

     const { error: upErr } = await supabase.storage
          .from(AVATAR_BUCKET)
          .upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });

     if (upErr) {
          toast(`Couldn't upload your photo: ${upErr.message}`, "error");
          return mountProfile();
     }

     const url = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;

     const { error } = await supabase.from(tableFor(u)).update({ avatar_url: url }).eq("id", u.id);

     if (error) {
          await supabase.storage.from(AVATAR_BUCKET).remove([path]); // don't leave an orphan
          toast(`Couldn't save your photo: ${error.message}`, "error");
          return mountProfile();
     }

     // tidy up the previous photo (best effort)
     const oldPath = photoPathFromUrl(u.avatar_url);
     if (oldPath) supabase.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => { });

     await loadData();
     refreshSidebarUser();
     mountProfile();
     toast("Profile photo updated.", "success");
}

async function removePhoto(u) {
     const ok = await confirmDialog({
          title: "Remove profile photo?",
          message: "Your initials will be shown instead.",
          confirmText: "Remove",
          cancelText: "Keep photo",
     });
     if (!ok) return;

     const { error } = await supabase.from(tableFor(u)).update({ avatar_url: null }).eq("id", u.id);
     if (error) return toast(`Couldn't remove your photo: ${error.message}`, "error");

     const oldPath = photoPathFromUrl(u.avatar_url);
     if (oldPath) supabase.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => { });

     await loadData();
     refreshSidebarUser();
     mountProfile();
     toast("Profile photo removed.", "success");
}

/* ============================================================
   CROPPER
   A square viewport with a circular guide. Drag to move; scroll,
   pinch or the slider to zoom; buttons rotate. Resolves with a
   512 × 512 JPEG Blob, or null if cancelled.
   ============================================================ */
function openCropper(file) {
     return new Promise((resolve) => {
          const objectUrl = URL.createObjectURL(file);
          const img = new Image();

          img.onerror = () => {
               URL.revokeObjectURL(objectUrl);
               toast("That image couldn't be opened. Try a JPG, PNG or WebP.", "error");
               resolve(null);
          };
          img.onload = () => buildCropper(img, objectUrl, resolve);
          img.src = objectUrl;
     });
}

function buildCropper(img, objectUrl, resolve) {
     const V = Math.max(200, Math.min(320, window.innerWidth - 72)); // viewport size in CSS px
     const iw = img.naturalWidth;
     const ih = img.naturalHeight;
     const st = { zoom: 1, rot: 0, cx: 0, cy: 0 }; // cx / cy: image-centre offset from viewport centre

     const bd = document.createElement("div");
     bd.className = "modal-backdrop";
     bd.style.zIndex = "9000";
     bd.innerHTML = `
      <div class="modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title" style="max-width:420px;margin-top:6vh">
        <div class="modal-head">
          <h3 id="crop-title">Adjust your photo</h3>
          <button type="button" class="modal-close" data-crop="cancel" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="crop-stage" style="width:${V}px;height:${V}px">
            <canvas class="crop-canvas"></canvas>
            <div class="crop-mask"></div>
          </div>
          <div class="crop-controls">
            <button type="button" class="btn btn-ghost btn-sm" data-crop="rot-l" title="Rotate left" aria-label="Rotate left">⟲</button>
            <input type="range" class="crop-zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom" />
            <button type="button" class="btn btn-ghost btn-sm" data-crop="rot-r" title="Rotate right" aria-label="Rotate right">⟳</button>
          </div>
          <p class="hint crop-hint">Drag to reposition · scroll or pinch to zoom</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-crop="reset">Reset</button>
          <button type="button" class="btn btn-ghost" data-crop="cancel">Cancel</button>
          <button type="button" class="btn btn-lime" data-crop="save">Use photo</button>
        </div>
      </div>`;
     document.body.appendChild(bd);

     const stage = bd.querySelector(".crop-stage");
     const canvas = bd.querySelector(".crop-canvas");
     const zoomInput = bd.querySelector(".crop-zoom");
     const ctx = canvas.getContext("2d");
     const dpr = Math.min(window.devicePixelRatio || 1, 2);
     canvas.width = V * dpr;
     canvas.height = V * dpr;
     canvas.style.width = `${V}px`;
     canvas.style.height = `${V}px`;

     /* ----- geometry ----- */
     const effective = () => (st.rot % 180 ? [ih, iw] : [iw, ih]);
     const baseScale = () => {
          const [ew, eh] = effective();
          return V / Math.min(ew, eh); // smallest scale that still covers the viewport
     };

     function clampState() {
          st.zoom = Math.min(Math.max(st.zoom, 1), MAX_ZOOM);
          const [ew, eh] = effective();
          const s = baseScale() * st.zoom;
          const mx = Math.max(0, (ew * s - V) / 2);
          const my = Math.max(0, (eh * s - V) / 2);
          st.cx = Math.min(Math.max(st.cx, -mx), mx);
          st.cy = Math.min(Math.max(st.cy, -my), my);
     }

     function paint(target, size) {
          const f = size / V;
          const s = baseScale() * st.zoom * f;
          target.fillStyle = "#fff";
          target.fillRect(0, 0, size, size);
          target.save();
          target.translate(size / 2 + st.cx * f, size / 2 + st.cy * f);
          target.rotate((st.rot * Math.PI) / 180);
          target.scale(s, s); // s already includes the output-size factor f
          target.drawImage(img, -iw / 2, -ih / 2);
          target.restore();
     }

     function redraw() {
          clampState();
          zoomInput.value = st.zoom;
          paint(ctx, V * dpr);
     }

     /* ----- pointer: drag + pinch ----- */
     const pointers = new Map();
     let lastPinch = 0;
     const pinchDistance = () => {
          const [a, b] = [...pointers.values()];
          return Math.hypot(a.x - b.x, a.y - b.y);
     };

     stage.addEventListener("pointerdown", (e) => {
          stage.setPointerCapture(e.pointerId);
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.size === 2) lastPinch = pinchDistance();
     });

     stage.addEventListener("pointermove", (e) => {
          const p = pointers.get(e.pointerId);
          if (!p) return;
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          p.x = e.clientX;
          p.y = e.clientY;

          if (pointers.size === 1) {
               st.cx += dx;
               st.cy += dy;
          } else if (pointers.size === 2) {
               const d = pinchDistance();
               if (lastPinch) st.zoom *= d / lastPinch;
               lastPinch = d;
          }
          redraw();
     });

     const endPointer = (e) => {
          pointers.delete(e.pointerId);
          lastPinch = 0;
     };
     stage.addEventListener("pointerup", endPointer);
     stage.addEventListener("pointercancel", endPointer);

     stage.addEventListener(
          "wheel",
          (e) => {
               e.preventDefault();
               st.zoom *= Math.exp(-e.deltaY * 0.0015);
               redraw();
          },
          { passive: false },
     );

     zoomInput.addEventListener("input", () => {
          st.zoom = parseFloat(zoomInput.value);
          redraw();
     });

     /* ----- buttons ----- */
     const rotate = (deg) => {
          st.rot = (st.rot + deg + 360) % 360;
          st.cx = 0;
          st.cy = 0;
          redraw();
     };

     function close(result) {
          window.removeEventListener("keydown", onKey, true);
          URL.revokeObjectURL(objectUrl);
          bd.remove();
          resolve(result);
     }

     bd.addEventListener("click", (e) => {
          if (e.target === bd) return close(null);
          const action = e.target.closest("[data-crop]")?.dataset.crop;
          if (action === "cancel") close(null);
          else if (action === "rot-l") rotate(-90);
          else if (action === "rot-r") rotate(90);
          else if (action === "reset") {
               st.zoom = 1;
               st.rot = 0;
               st.cx = 0;
               st.cy = 0;
               redraw();
          } else if (action === "save") {
               const out = document.createElement("canvas");
               out.width = OUTPUT_PX;
               out.height = OUTPUT_PX;
               paint(out.getContext("2d"), OUTPUT_PX);
               out.toBlob(
                    (blob) => {
                         if (!blob) {
                              toast("Couldn't process that photo.", "error");
                              return close(null);
                         }
                         close(blob);
                    },
                    "image/jpeg",
                    0.9,
               );
          }
     });

     // capture phase: Esc closes only the cropper
     function onKey(e) {
          if (e.key === "Escape") {
               e.preventDefault();
               e.stopPropagation();
               close(null);
          }
     }
     window.addEventListener("keydown", onKey, true);

     redraw();
     bd.querySelector('[data-crop="save"]').focus();
}