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