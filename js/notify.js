"use strict";

import { supabase } from "./supabase.js";
import { toast } from "./common.js";

/* ============================================================
    notify.js — emails the project manager when an employee
    updates a project's progress, via the `notify-pm` Supabase
    Edge Function. Never throws; callers don't need to await it.
   ============================================================ */

/** supabase-js hides the function's real error body inside error.context. */
async function realErrorMessage(error) {
    try {
        if (error?.context?.json) {
            const body = await error.context.json();
            return body?.error || JSON.stringify(body);
        }
    } catch (_) {
        /* fall through */
    }
    return error?.message || "Unknown error";
}

export async function emailProjectManager(
    project,
    { employeeId, oldProgress, newProgress, note, source, work },
) {
    if (!project?.projectManagerId) {
        console.warn("[notify] skipped: this project has no project manager", project);
        return;
    }

    const body = {
        taskId: project.id,
        employeeId,
        oldProgress,
        newProgress,
        note: note || "",
        source: source || "project update",
        work: work || null, // { start, end, minutes } from a daily worksheet
        // link for the email button: the project manager's dashboard, next to this page
        appUrl: new URL("pm.html", window.location.href).href,
    };
    console.log("[notify] calling notify-pm", body);

    try {
        const { data, error } = await supabase.functions.invoke("notify-pm", { body });

        if (error) throw new Error(await realErrorMessage(error));
        if (data?.error) throw new Error(data.error);

        console.log("[notify] email sent", data);
    } catch (e) {
        console.warn("[notify] PM email failed:", e);
        toast(`Progress saved, but the project manager couldn't be emailed: ${e.message}`, "error");
    }
}

/**
 * Emails the assignee(s) when an admin / project manager asks for an update.
 *   taskIds      projects the request was just saved on (update_requested = true)
 *   employeeIds  optional: only email these people (used by the "Ask for update"
 *                button in the People table, where the request targets one person)
 *   requesterId  the admin / project manager who pressed the button
 * One email per person, listing all of their requested projects.
 * Never throws; callers don't need to await it.
 */
export async function emailEmployeesUpdateRequest({ taskIds, employeeIds, requesterId }) {
    if (!taskIds?.length) return;

    const body = {
        taskIds,
        employeeIds: employeeIds || null,
        requesterId,
        // link for the email button: the employee dashboard, next to this page
        appUrl: new URL("employee.html", window.location.href).href,
    };
    console.log("[notify] calling notify-employee", body);

    try {
        const { data, error } = await supabase.functions.invoke("notify-employee", { body });

        if (error) throw new Error(await realErrorMessage(error));
        if (data?.error) throw new Error(data.error);

        console.log("[notify] update-request email(s) sent", data);

        if (data?.sent) {
            toast(`Reminder emailed to ${data.sent} ${data.sent === 1 ? "person" : "people"}.`, "success");
        }
        if (data?.skipped?.length) {
            toast(`No email address on file for: ${data.skipped.join(", ")}.`, "info");
        }
        if (!data?.sent && !data?.skipped?.length) {
            toast("Update requested, but nobody was found to email.", "info");
        }
    } catch (e) {
        console.warn("[notify] employee email failed:", e);
        toast(`Update requested, but the email couldn't be sent: ${e.message}`, "error");
    }
}