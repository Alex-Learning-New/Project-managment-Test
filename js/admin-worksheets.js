"use strict";

import { supabase } from "./supabase.js";
import { state } from "./state.js";
import {
    escapeHtml, avatarHtml, fmtDate, toast,
    currentUser, tasksManagedBy, employeesInTasks,
} from "./common.js";

/* ============================================================
    admin-worksheets.js — the admin "Worksheets" tab
    Reads submitted daily worksheets from the `worksheets` table,
    with search / date / status filters, today's stats and a detail
    modal (description, remarks, task progress, uploaded files).
    Two scopes share this code:
        admin — every worksheet, every employee
        pm    — only worksheets logged against projects (tasks) that the
                signed-in project manager manages
   ============================================================ */

const STATUS_META = {
    completed: { label: "Completed", badge: "done" },
    "in-progress": { label: "In progress", badge: "progress" },
    pending: { label: "Pending", badge: "todo" },
    blocked: { label: "Blocked", badge: "overdue" },
};

let rows = [];
let bound = false;
let scope = "admin";

const $ = (id) => document.getElementById(id);

function localDate(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatHours(h) {
    const mins = Math.round(Number(h || 0) * 60);
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    if (hh && mm) return `${hh} hr ${mm} min`;
    if (hh) return `${hh} hr`;
    return `${mm} min`;
}

function statusBadge(status) {
    const m = STATUS_META[status] || { label: status, badge: "todo" };
    return `<span class="badge badge-${m.badge}"><span class="dot"></span>${m.label}</span>`;
}

function personFor(row) {
    return (
        state.users.find((u) => u.id === row.user_id) || {
            id: row.user_id,
            name: row.user_name || row.user_id,
        }
    );
}

/* ---------- stats ---------- */
function renderStats() {
    const today = localDate();
    const todays = rows.filter((r) => r.work_date === today);
    const hours = todays.reduce((s, r) => s + Number(r.total_hours || 0), 0);

    const employees =
        scope === "pm"
            ? employeesInTasks(tasksManagedBy(currentUser().id)).filter((u) => u.role === "employee")
            : state.users.filter((u) => u.role === "employee");
    const submittedIds = new Set(todays.map((r) => r.user_id));
    const pending = employees.filter((u) => !submittedIds.has(u.id)).length;

    $("ws-admin-stats").innerHTML = `
      <div class="stat-card"><div class="label">Submitted today</div><div class="num">${todays.length}</div><div class="delta">${submittedIds.size} of ${employees.length} employees</div></div>
      <div class="stat-card"><div class="label">Hours logged today</div><div class="num">${Math.round(hours * 10) / 10}</div><div class="delta">Across all submissions</div></div>
      <div class="stat-card"><div class="label">Yet to submit today</div><div class="num" style="${pending ? "color:var(--coral)" : ""}">${pending}</div><div class="delta">${pending ? "No worksheet from them yet" : "Everyone has submitted"}</div></div>`;
}

/* ---------- table ---------- */
function filteredRows() {
    const search = ($("ws-search")?.value || "").trim().toLowerCase();
    const date = $("ws-date-filter")?.value || "";
    const status = $("ws-status-filter")?.value || "all";

    return rows.filter((r) => {
        if (date && r.work_date !== date) return false;
        if (status !== "all" && r.work_status !== status) return false;
        if (!search) return true;
        return [r.user_name, r.project_title, r.work_title]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(search));
    });
}

function renderTable() {
    const list = filteredRows();
    const body = $("ws-admin-table");

    if (!list.length) {
        body.innerHTML = `<tr><td colspan="8"><div class="empty-row">${rows.length ? "No worksheets match these filters." : scope === "pm" ? "No worksheets on your projects yet." : "No worksheets submitted yet."}</div></td></tr>`;
        return;
    }

    body.innerHTML = list
        .map((r) => {
            const person = personFor(r);
            return `<tr class="clickable" data-ws="${r.id}">
        <td>${fmtDate(r.work_date)}</td>
        <td><div style="display:flex;align-items:center;gap:10px;">${avatarHtml(person)}<b>${escapeHtml(person.name)}</b></div></td>
        <td>${escapeHtml(r.project_title || "—")}</td>
        <td style="max-width:240px;">${escapeHtml(r.work_title)}</td>
        <td style="white-space:nowrap;">${escapeHtml(r.start_time)} – ${escapeHtml(r.end_time)}</td>
        <td style="white-space:nowrap;">${formatHours(r.total_hours)}</td>
        <td>${statusBadge(r.work_status)}</td>
        <td><button class="btn btn-sm btn-ghost" data-view-ws="${r.id}">View</button></td>
      </tr>`;
        })
        .join("");

    body.querySelectorAll("tr.clickable").forEach((tr) =>
        tr.addEventListener("click", () => openDetail(tr.dataset.ws)),
    );
}

/* ---------- detail modal ---------- */
function openDetail(id) {
    const r = rows.find((x) => String(x.id) === String(id));
    if (!r) return;

    const person = personFor(r);
    const files = Array.isArray(r.files) ? r.files : [];

    $("ws-detail-title").textContent = r.work_title;

    $("ws-detail-body").innerHTML = `
      <div class="detail-meta-grid">
        <div class="mi"><div class="k">Employee</div><div class="v">${escapeHtml(person.name)}</div></div>
        <div class="mi"><div class="k">Department</div><div class="v">${escapeHtml(person.department || "—")}</div></div>
        <div class="mi"><div class="k">Date</div><div class="v">${fmtDate(r.work_date)}</div></div>
        <div class="mi"><div class="k">Project</div><div class="v">${escapeHtml(r.project_title || "—")}</div></div>
        <div class="mi"><div class="k">Time</div><div class="v">${escapeHtml(r.start_time)} – ${escapeHtml(r.end_time)}</div></div>
        <div class="mi"><div class="k">Total hours</div><div class="v">${formatHours(r.total_hours)}</div></div>
        <div class="mi"><div class="k">Status</div><div class="v">${statusBadge(r.work_status)}</div></div>
        ${r.task_progress != null ? `<div class="mi"><div class="k">Project progress</div><div class="v">${r.task_progress}%</div></div>` : ""}
        <div class="mi"><div class="k">Submitted</div><div class="v">${new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div>
      </div>

      <div class="section-title">Work description</div>
      <p class="ws-detail-text">${escapeHtml(r.description)}</p>

      <div class="section-title">Remarks</div>
      <p class="ws-detail-text">${r.remarks ? escapeHtml(r.remarks) : '<span class="hint">No remarks added.</span>'}</p>

      <div class="section-title">Project files</div>
      ${files.length
            ? files
                .map(
                    (f) => `<div class="file-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
              <a class="fname" href="#" data-file-path="${escapeHtml(f.path || "")}" data-file-bucket="${escapeHtml(f.bucket || "")}">${escapeHtml(f.name)}</a>
            </div>`,
                )
                .join("")
            : '<div class="hint">No files uploaded.</div>'
        }`;

    $("modal-worksheet-detail").classList.remove("hidden");
}

/* ---------- entry point ---------- */
export const renderAdminWorksheets = () => loadWorksheets("admin");
export const renderPmWorksheets = () => loadWorksheets("pm");

async function loadWorksheets(newScope) {
    if (scope !== newScope) rows = [];
    scope = newScope;

    if (!bound) {
        ["ws-search", "ws-date-filter", "ws-status-filter"].forEach((id) => {
            $(id).addEventListener("input", renderTable);
            $(id).addEventListener("change", renderTable);
        });
        bound = true;
    }

    if (!rows.length) {
        $("ws-admin-table").innerHTML = `<tr><td colspan="8"><div class="empty-row">Loading worksheets…</div></td></tr>`;
    }

    let query = supabase
        .from("worksheets")
        .select("*")
        .order("work_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);

    if (scope === "pm") query = query.eq("project_manager_id", currentUser().id);

    const { data, error } = await query;

    if (error) {
        toast(`Couldn't load worksheets: ${error.message}`, "error");
        $("ws-admin-table").innerHTML = `<tr><td colspan="8"><div class="empty-row">Couldn't load worksheets.</div></td></tr>`;
        return;
    }

    rows = data || [];
    renderStats();
    renderTable();
}