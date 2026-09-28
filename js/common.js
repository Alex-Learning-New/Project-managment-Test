"use strict";

import { loadDatabase } from "./data.js";
import { state } from "./state.js";
import { openStoredFile } from "./storage.js";

/* ============================================================
   common.js — shared by index.html, admin.html and employee.html
   Load order: data.js → common.js → (login.js | admin.js | employee.js)
   ============================================================ */

// const STATE_KEY = "taskflow_state_v1";
const SESSION_KEY = "taskflow_session_v1";

/* ================= AVATARS & FORMATTING ================= */
const AVATAR_COLORS = [
    "#A6E000",
    "#8FD9C4",
    "#F3C969",
    "#F2A6A6",
    "#B9AEF0",
    "#8FC4E8",
    "#F0C6E0",
];

export function colorFor(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name) {
    return name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
}

export function avatarHtml(user, size) {
    const cls = size === "lg" ? "avatar avatar-lg" : "avatar";
    return `<div class="${cls}" style="background:${colorFor(user.id)}">${initials(user.name)}</div>`;
}

export function escapeHtml(s) {
    return String(s || "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
}

export function today() {
    return new Date().toISOString().slice(0, 10);
}

export function fmtDate(d) {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ================= STATE ================= */
// const state = {
//     users: [],
//     teams: [],
//     projectManagers: [],
//     tasks: [],
//     currentUser: null,
// };

// export function saveState() {
//     try {
//         localStorage.setItem(
//             STATE_KEY,
//             JSON.stringify({
//                 users: state.users,
//                 teams: state.teams,
//                 projectManagers: state.projectManagers,
//                 tasks: state.tasks,
//             }),
//         );
//     } catch (e) {
//         /* storage unavailable, continue in-memory */
//     }
// }

// export function loadState() {
//     try {
//         const raw = localStorage.getItem(STATE_KEY);
//         if (raw) {
//             const parsed = JSON.parse(raw);
//             state.users = parsed.users || seedUsers;
//             state.teams = parsed.teams || seedTeams;
//             state.projectManagers = parsed.projectManagers || seedProjectManagers;
//             state.tasks = parsed.tasks || seedTasks;
//         }
//     } catch (e) {
//         /* fall back to seed */
//     }

//     // Older saved data may contain tasks without a project manager
//     let migrated = false;
//     state.tasks.forEach((task) => {
//         if (!task.projectManagerId) {
//             task.projectManagerId = Math.random() > 0.5 ? "pm1" : "pm2";
//             migrated = true;
//         }
//     });
//     if (migrated) saveState();
// }

/* ================= SESSION ================= */
// The session lives in sessionStorage so it survives the redirect from
// the login page to admin.html / employee.html, but ends with the tab.
export function getSessionUserId() {
    try {
        return sessionStorage.getItem(SESSION_KEY);
    } catch (e) {
        return null;
    }
}

export function setSession(userId) {
    try {
        sessionStorage.setItem(SESSION_KEY, userId);
    } catch (e) {
        /* ignore */
    }
}

export function clearSession() {
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
        /* ignore */
    }
}

export function pageForRole(role) {
    if (role === "admin") return "admin.html";
    if (role === "project-manager") return "pm.html";
    return "employee.html";
}

/** Looks a person up by id across both the users table and the
 *  project_managers table, and tags the result with a `role` so the
 *  rest of the app can treat admins, employees and PMs the same way. */
export function findPerson(id) {
    const user = getUser(id);
    if (user) return user;

    const pm = getProjectManager(id);
    if (pm) return { ...pm, role: "project-manager" };

    return null;
}

/** Returns the signed-in user if they have the required role, otherwise
 *  sends them back to the login page and returns null. */
export function requireRole(role) {
    const person = findPerson(getSessionUserId());
    if (!person || person.role !== role) {
        window.location.replace("index.html");
        return null;
    }
    return person;
}

/* ================= LOOKUPS & TASK HELPERS ================= */
export function getUser(id) {
    return state.users.find((u) => u.id === id);
}
export function getTeam(id) {
    return state.teams.find((t) => t.id === id);
}
export function getProjectManager(id) {
    return state.projectManagers.find((pm) => pm.id === id);
}
export function currentUser() {
    return findPerson(state.currentUser);
}

/** All tasks a project manager is overseeing, regardless of who the
 *  actual assignee (employee/team) is. */
export function tasksManagedBy(pmId) {
    return state.tasks.filter((t) => t.projectManagerId === pmId);
}

/** Distinct teams that appear among a set of tasks. */
export function teamsInTasks(tasks) {
    const ids = new Set(
        tasks.filter((t) => t.assigneeType === "team").map((t) => t.assigneeId),
    );
    return state.teams.filter((t) => ids.has(t.id));
}

/** Distinct employees that appear among a set of tasks, whether assigned
 *  directly or as part of an assigned team. */
export function employeesInTasks(tasks) {
    const ids = new Set();
    tasks.forEach((t) => {
        if (t.assigneeType === "employee") {
            ids.add(t.assigneeId);
        } else if (t.assigneeType === "team") {
            const team = getTeam(t.assigneeId);
            (team?.member_ids || []).forEach((uid) => ids.add(uid));
        }
    });
    return state.users.filter((u) => ids.has(u.id));
}

/** Records an event (currently just task deletions) to the activity_log
 *  table so it can still show up in "recent activity" feeds after the
 *  task itself is gone. Never throws — a logging failure shouldn't block
 *  the action that triggered it. */
export async function logActivity({ type, taskTitle, actor, projectManagerId }) {
    try {
        await supabase.from("activity_log").insert({
            type,
            task_title: taskTitle,
            actor_id: actor?.id || null,
            actor_name: actor?.name || "Someone",
            actor_role: actor?.role || null,
            project_manager_id: projectManagerId || null,
            date: today(),
        });
    } catch (e) {
        console.error(e);
    }
}

export function isOverdue(t) {
    return t.status !== "done" && t.due < today();
}
export function effectiveStatus(t) {
    return isOverdue(t) ? "overdue" : t.status;
}
export function statusLabel(s) {
    return (
        {
            todo: "To do",
            "in-progress": "In progress",
            review: "In review",
            done: "Done",
            overdue: "Overdue",
        }[s] || s
    );
}

export function assigneeNames(t) {
    if (t.assigneeType === "project-manager") {
        const pm = getProjectManager(t.assigneeId);
        return pm ? [{ id: pm.id, name: pm.name }] : [];
    }
    if (t.assigneeType === "employee") {
        const u = getUser(t.assigneeId);
        return u ? [u] : [];
    }
    const team = getTeam(t.assigneeId);
    if (!team) return [];
    return team.member_ids.map(getUser).filter(Boolean);
}

export function tasksFor(userId) {

    const user = getUser(userId);

    // console.log("Current User:", user);
    // console.log("User Team:", user?.teamId);
    // console.log("All Tasks:", state.tasks);

    const result = state.tasks.filter(task => {

        if (task.assigneeType === "employee") {
            return task.assigneeId === userId;
        }

        if (task.assigneeType === "team") {
            return user.teamIds?.includes(task.assigneeId);
        }

        return false;
    });

    // console.log("My Tasks:", result);

    return result;
}


/* ================= TOASTS ================= */
export function toast(message, type = "info") {
    const svg = (paths) =>
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`;
    const icons = {
        success: svg('<path d="M20 6L9 17l-5-5"/>'),
        error: svg(
            '<circle cx="12" cy="12" r="10"/><path d="M15 9L9 15"/><path d="M9 9L15 15"/>',
        ),
        info: svg(
            '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        ),
    };

    const wrap = document.getElementById("toast-wrap");
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = icons[type] + message;
    wrap.appendChild(el);

    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateX(30px)";
        setTimeout(() => el.remove(), 250);
    }, 3000);
}

/* ================= SHARED UI FRAGMENTS ================= */
export function statCard(label, num, delta, warn) {
    return `<div class="stat-card"><div class="label">${label}</div><div class="num" style="${warn ? "color:var(--coral)" : ""}">${num}</div><div class="delta">${delta}</div></div>`;
}

export function taskRowHtml(t) {
    const es = effectiveStatus(t);
    const assignees = assigneeNames(t);
    const stack = assignees
        .slice(0, 3)
        .map(
            (u) =>
                `<div class="avatar" style="background:${colorFor(u.id)}">${initials(u.name)}</div>`,
        )
        .join("");
    return `<div class="task-row status-${es === "overdue" ? "overdue" : t.status}" data-task="${t.id}">
    <div class="task-main">
        <div class="t-title">${escapeHtml(t.title)} ${t.updateRequested ? '<span class="req-badge">• update requested</span>' : ""}</div>
        <div class="t-meta">
        <span class="badge badge-${es === "overdue" ? "overdue" : t.status.replace("in-progress", "progress")}"><span class="dot"></span>${statusLabel(es)}</span>
        <span>${t.assigneeType === "team" ? "👥 " + (getTeam(t.assigneeId)?.name || "Team") : assignees[0]?.name || "Unassigned"}</span>
        <span>Due ${fmtDate(t.due)}</span>
    </div>
    </div>
    <div class="task-progress-mini">
        <div class="pbar"><div style="width:${t.progress}%"></div></div>
        <div class="progress-num">${t.progress}%</div>
    </div>
    <div class="assignee-stack">${stack}</div>
  </div>`;
}

/** Shared "recent activity" feed used by both the admin and PM overview
 *  pages: task report/assignment events plus any activity_log entries
 *  (currently just task deletions), merged and sorted by date. Deletions
 *  have to come from a persisted log since the task itself is gone by
 *  the time this renders. */
export function recentActivityHtml(tasks, activityLog = []) {
    const taskEvents = tasks.map((t) => {
        const lastReport = t.reports[t.reports.length - 1];
        const names = assigneeNames(t)
            .map((u) => u.name)
            .join(", ");
        return {
            date: lastReport?.date || t.created,
            html: `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--lime-dark);margin-top:7px;flex:none;"></div>
        <div style="flex:1;font-size:13.5px;">
        <b>${escapeHtml(names || "Unassigned")}</b> ${lastReport ? "submitted an update on" : "was assigned"} <b>${escapeHtml(t.title)}</b>
        <div class="hint" style="margin-top:2px;">${fmtDate(lastReport?.date || t.created)}</div>
        </div>
    </div>`,
        };
    });

    const deletionEvents = activityLog.map((a) => ({
        date: a.date,
        html: `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--coral);margin-top:7px;flex:none;"></div>
        <div style="flex:1;font-size:13.5px;">
        <b>${escapeHtml(a.actorName || "Someone")}</b>${a.actorRole === "project-manager" ? " (PM)" : ""} deleted <b>${escapeHtml(a.taskTitle || "a task")}</b>
        <div class="hint" style="margin-top:2px;">${fmtDate(a.date)}</div>
        </div>
    </div>`,
    }));

    const merged = [...taskEvents, ...deletionEvents]
        .sort((x, y) => (y.date || "").localeCompare(x.date || ""))
        .slice(0, 5);

    return merged.length
        ? merged.map((e) => e.html).join("")
        : `<div class="empty-row">No activity yet.</div>`;
}

/** Makes every task row inside a container open the detail modal. */
export function attachTaskRowHandlers(containerId, onOpen) {
    document
        .getElementById(containerId)
        .querySelectorAll(".task-row")
        .forEach((row) => {
            row.addEventListener("click", () => onOpen(row.dataset.task));
        });
}

export function filesHtml(t) {
    if (!t.files.length)
        return `<div class="hint" style="padding:6px 0 4px;">No files uploaded yet.</div>`;
    return t.files
        .map(
            (f) => `<div class="file-item">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
    ${f.path ? `<a href="#" class="fname" data-file-path="${escapeHtml(f.path)}" data-file-bucket="${escapeHtml(f.bucket || "")}">${escapeHtml(f.name)}</a>` : `<span class="fname">${escapeHtml(f.name)}</span>`}<span class="fdate">${fmtDate(f.date)}</span>
  </div>`,
        )
        .join("");
}

export function reportsHtml(t) {
    if (!t.reports.length)
        return `<div class="hint" style="padding:6px 0 4px;">No reports submitted yet.</div>`;
    return [...t.reports]
        .reverse()
        .map(
            (r) => `<div class="report-item">
    <div class="r-meta"><b>${escapeHtml(r.author || "")}</b> · ${fmtDate(r.date)}</div>
    <div class="r-text">${escapeHtml(r.text)}</div>
  </div>`,
        )
        .join("");
}

/** The read-only part of the task detail modal, identical for both roles.
 *  Each role adds its own controls and footer on top of this. */
export function taskDetailBodyHtml(t, { alwaysShowFiles = false } = {}) {
    const es = effectiveStatus(t);
    const assignedTo =
        t.assigneeType === "team"
            ? getTeam(t.assigneeId)?.name || "Team"
            : assigneeNames(t)[0]?.name || "—";
    const pmName = getProjectManager(t.projectManagerId)?.name || "Not Assigned";

    let body = "";
    if (t.updateRequested) {
        body += `<div class="update-banner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>An update has been requested on this task.</div>`;
    }
    body += `<p style="color:var(--ink-soft);font-size:14.5px;line-height:1.6;margin-top:0;">${escapeHtml(t.description || "No description provided.")}</p>`;
    body += `<div class="detail-meta-grid">
    <div class="mi"><div class="k">Status</div><div class="v"><span class="badge badge-${es === "overdue" ? "overdue" : t.status.replace("in-progress", "progress")}"><span class="dot"></span>${statusLabel(es)}</span></div></div>
    <div class="mi"><div class="k">Priority</div><div class="v" style="text-transform:capitalize;">${escapeHtml(t.priority)}</div></div>
    <div class="mi"><div class="k">Due date</div><div class="v">${fmtDate(t.due)}</div></div>
    <div class="mi"><div class="k">Assigned to</div><div class="v">${escapeHtml(assignedTo)}</div></div>
    <div class="mi"><div class="k">Project Manager</div><div class="v">${escapeHtml(pmName)}</div></div>
  </div>`;

    body += `<div class="section-title">Progress</div>
  <div class="pbar" style="height:9px;margin-bottom:6px;"><div style="width:${t.progress}%"></div></div>
  <div class="progress-num" style="font-size:13px;">${t.progress}% complete</div>`;

    if (t.files.length || alwaysShowFiles) {
        body += `<div class="section-title">Files</div><div id="td-files">${filesHtml(t)}</div>`;
    }

    body += `<div class="section-title">Reports & updates</div><div id="td-reports">${reportsHtml(t)}</div>`;
    return body;
}

/* ================= STATUS CHART ================= */
const STATUS_CHART_KEYS = ["todo", "in-progress", "review", "done", "overdue"];
const STATUS_CHART_LABELS = ["To Do", "In Progress", "Review", "Done", "Overdue"];
const STATUS_CHART_COLORS = ["#6366f1", "#06b6d4", "#f59e0b", "#22c55e", "#ef4444"];

/** Draws (or redraws) the status doughnut and returns the Chart instance.
 *  Pass the previous instance so it can be destroyed first. */
export function drawStatusChart(containerId, tasks) {

    const counts = STATUS_CHART_KEYS.map(
        key => tasks.filter(
            t => effectiveStatus(t) === key
        ).length
    );

    Highcharts.chart(containerId, {

        chart: {
            type: 'pie',
            options3d: {
                enabled: true,
                alpha: 45,
                beta: 0
            },
            backgroundColor: 'transparent'
        },

        title: {
            text: null
        },

        plotOptions: {
            pie: {
                allowPointSelect: true,
                cursor: 'pointer',
                innerSize: '40%' ,
                depth: 35,
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}'
                }
            }
        },

        series: [{
            name: 'Tasks',
            data: [
                ['To Do', counts[0]],
                ['In Progress', counts[1]],
                ['Review', counts[2]],
                ['Done', counts[3]],
                ['Overdue', counts[4]]
            ]
        }],

        credits: {
            enabled: false
        },

        exporting: {
            enabled: false
        }

    });
}

/* ================= ID GENERATION ================= */
/** Next free id for a table whose ids look like "k7" / "t3".
 *  Uses the highest number in use (not the row count), so deleting a
 *  task or team can never make a new id collide with an existing one. */
export async function nextId(table, prefix) {
    const { data, error } = await supabase.from(table).select("id");
    if (error) throw error;

    const max = (data || []).reduce((m, row) => {
        const n = parseInt(String(row.id).replace(/^\D+/, ""), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);

    return `${prefix}${max + 1}`;
}

/* ================= STORED FILE LINKS ================= */
// Any element with data-file-path opens that file through a short-lived
// signed URL (see storage.js). Works for task files and worksheet files.
document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-file-path]");
    if (!el) return;
    e.preventDefault();
    try {
        await openStoredFile({
            name: el.textContent.trim(),
            path: el.dataset.filePath,
            bucket: el.dataset.fileBucket || undefined,
        });
    } catch (err) {
        toast(err.message, "error");
    }
});

/* ================= MODAL HELPERS ================= */
export function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
}

export function initModals() {
    document.querySelectorAll(".modal-backdrop").forEach((bd) => {
        bd.addEventListener("click", (e) => {
            if (e.target === bd) bd.classList.add("hidden");
        });
        bd.querySelectorAll("[data-close]").forEach((b) =>
            b.addEventListener("click", () => bd.classList.add("hidden")),
        );
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
            document
                .querySelectorAll(".modal-backdrop")
                .forEach((bd) => bd.classList.add("hidden"));
    });
}

/* ================= APP SHELL (sidebar, nav, topbar) ================= */
let shell = null;

/**
 * Sets up the page shell for admin.html / employee.html.
 *
 * config = {
 *   role:          "admin" | "employee"  — anyone else is sent to login
 *   defaultView:   view id to open first
 *   titles:        { [viewId]: [title, subtitle] }
 *   topbarActions: { [viewId]: { label, onClick } }   (optional)
 *   render:        (viewId) => void      — draws a view
 *   updateNavCounts: () => void          — refreshes sidebar badges
 * }
 */
export function initShell(config) {
    const user = requireRole(config.role);
    if (!user) return null;

    shell = config;
    state.currentUser = user.id;

    const avatar = document.getElementById("sidebar-avatar");
    avatar.style.background = colorFor(user.id);
    avatar.textContent = initials(user.name);
    document.getElementById("sidebar-name").textContent = user.name;
    const ROLE_LABELS = {
        admin: "Admin",
        employee: "Employee",
        "project-manager": "Project Manager",
    };
    document.getElementById("sidebar-role").textContent =
        ROLE_LABELS[user.role] || user.role;

    document.getElementById("logout-btn").addEventListener("click", () => {
        clearSession();
        window.location.href = "index.html";
    });

    // Signing out in another tab, or using the back button after logout
    window.addEventListener("pageshow", (e) => {
        if (e.persisted) requireRole(config.role);
    });

    /* mobile sidebar */
    const sidebar = document.getElementById("sidebar");
    const scrim = document.getElementById("sidebar-scrim");
    const menuBtn = document.getElementById("menu-btn");
    menuBtn.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        scrim.classList.toggle("show");
    });
    scrim.addEventListener("click", closeSidebar);
    const checkMobile = () =>
        menuBtn.classList.toggle("hidden", window.innerWidth > 880);
    checkMobile();
    window.addEventListener("resize", checkMobile);

    /* nav */
    document.querySelectorAll(".nav-item").forEach((btn) => {
        btn.addEventListener("click", () => goView(btn.dataset.view));
    });

    initModals();
    goView(config.defaultView);
    return user;
}

export function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-scrim").classList.remove("show");
}

export function goView(viewId) {
    document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.add("hidden"));
    document.getElementById("view-" + viewId).classList.remove("hidden");
    document
        .querySelectorAll(".nav-item")
        .forEach((b) => b.classList.toggle("active", b.dataset.view === viewId));

    const [title, sub] = shell.titles[viewId];
    document.getElementById("topbar-title").textContent = title;
    document.getElementById("topbar-sub").textContent = sub;

    renderTopbarActions(viewId);
    renderView(viewId);
    closeSidebar();
    window.scrollTo(0, 0);
}

export function renderTopbarActions(viewId) {
    const el = document.getElementById("topbar-actions");
    el.innerHTML = "";
    const action = shell.topbarActions?.[viewId];
    if (!action) return;
    const b = document.createElement("button");
    b.className = "btn btn-lime";
    b.textContent = action.label;
    b.onclick = action.onClick;
    el.appendChild(b);
}

export function renderView(viewId) {
    shell.render(viewId);
    shell.updateNavCounts();
}

export function rerenderCurrent() {
    const active = document.querySelector(".nav-item.active");
    if (active) renderView(active.dataset.view);
}

import { supabase } from './supabase.js';

export async function initializeApp() {

    const db = await loadDatabase();

    state.users = db.users;
    state.teams = db.teams;
    state.tasks = db.tasks;
    state.projectManagers = db.projectManagers;
    state.departments = db.departments;
    state.activityLog = db.activityLog;

}

// export async function loadDatabase() {

//     const { data: users } =
//         await supabase.from('users').select('*');

//         const { data: teams } =
//         await supabase.from('teams').select('*');

//     const { data: projectManagers } =
//         await supabase.from('project_managers').select('*');

//     const { data: tasks } =
//     await supabase.from('tasks').select('*');

//     state.users = (users || []).map(u => ({
//         ...u,
//         pos: u.position,
//         teamId: u.team_id
//     }));

//     state.teams = (teams || []).map(t => ({
//         ...t,
//         member_ids: t.member_ids || []
//     }));

//     state.projectManagers = projectManagers || [];

//     state.tasks = (tasks || []).map(task => ({
//         ...task,
//         assigneeType: task.assignee_type,
//         assigneeId: task.assignee_id,
//         projectManagerId: task.project_manager_id,
//         updateRequested: task.update_requested
//     }));

//     console.log(users);
//     console.log(teams);
//     console.log(projectManagers);
//     console.log(tasks);
// }

await initializeApp();

export { state };